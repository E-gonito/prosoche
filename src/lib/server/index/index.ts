/**
 * The searchable index over the vault.
 *
 * This module owns the database entirely: no SQL exists anywhere else, and
 * callers pass and receive plain objects. The index is a cache, so every
 * method is safe to call against an empty or stale database, and `rebuild`
 * restores it from the markdown at any time.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';
import { DAILY_NOTE_GLOB } from '../daily';
import { parseNote } from '../parse/note';
import { scanTasks } from '../parse/task';
import type { Task, TaskStatus } from '$lib/shared/task';
import { SCHEMA, SCHEMA_VERSION } from './schema';

/** Kept as an alias so existing call sites read naturally. */
export type IndexedTask = Task;

export interface SearchHit {
	path: string;
	title: string;
	/** Matching text with the query terms marked by «» so the UI can highlight. */
	snippet: string;
}

export interface IndexHealth {
	notes: number;
	tasks: number;
	links: number;
	tags: number;
	problems: Array<{ path: string; message: string }>;
	lastBuildMs: number | null;
}

export interface IndexedNote {
	path: string;
	title: string;
	mtimeMs: number;
	bytes: number;
}

export interface TaskQuery {
	/** Membership by tag, including nested tags: `ws/work` matches `ws/work/api`. */
	tags?: string[];
	/** Membership by folder. A task under `Work/` belongs to `Work`. */
	under?: string[];
	statuses?: TaskStatus[];
	quadrant?: number;
	requireQuadrant?: boolean;
	/** Only tasks with a due date at or before this `YYYY-MM-DD`. */
	dueOnOrBefore?: string;
	/** Only tasks waiting on another. */
	blocked?: boolean;
	/**
	 * Skip the dated daily notes. Every daily note is a copy of one template,
	 * so without this a cross-day list repeats the same unfinished checklist
	 * once per day. Unlike excluding the journal folder, this leaves alone the
	 * workspace notes that happen to live inside it.
	 */
	excludeDailyNotes?: boolean;
	excludePrefixes?: string[];
	includeFenced?: boolean;
	limit?: number;
}

/**
 * Task columns plus the line's tags, rolled up in the query so a task arrives
 * complete rather than needing a second lookup per row.
 */
const TASK_COLUMNS = `t.*, (SELECT group_concat(g.tag, ' ') FROM task_tags g WHERE g.path = t.path AND g.line = t.line) AS tags`;

/**
 * What a note carrying an unfinished merge is recorded as. Exported so a page
 * can recognise the one problem it knows how to explain without matching on
 * prose it does not own.
 */
export const CONFLICT_MARKERS = 'has git conflict markers';

/** Git writes both, at the start of a line, around every conflicted region. */
const CONFLICT_START = /^<<<<<<< /m;
const CONFLICT_END = /^>>>>>>> /m;

export class NoteIndex {
	private db: Database.Database;

	constructor(dbPath: string = config.dbPath) {
		if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
		this.db = new Database(dbPath);
		this.db.pragma('journal_mode = WAL');
		this.migrate();
		this.db.exec(SCHEMA);
		this.setMeta('schema_version', String(SCHEMA_VERSION));
	}

	/** Parse one note and replace everything the index holds about it. */
	put(path: string, content: string, mtimeMs = Date.now(), hash = ''): void {
		const run = this.db.transaction(() => {
			this.forget(path);
			let note;
			try {
				note = parseNote(content, path);
			} catch (e) {
				this.db
					.prepare('INSERT OR REPLACE INTO problems (path, message) VALUES (?, ?)')
					.run(path, e instanceof Error ? e.message : String(e));
				return;
			}

			this.db
				.prepare('INSERT OR REPLACE INTO notes (path, title, hash, mtime_ms, bytes, frontmatter) VALUES (?,?,?,?,?,?)')
				.run(path, note.title, hash, mtimeMs, Buffer.byteLength(content), JSON.stringify(note.frontmatter));

			const task = this.db.prepare(
				`INSERT OR REPLACE INTO tasks (path,line,block_end,status,start_min,end_min,text,quadrant,fenced,raw,task_id,blocked_by,due)
				 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
			);
			const taskTag = this.db.prepare('INSERT OR REPLACE INTO task_tags (path,line,tag) VALUES (?,?,?)');
			for (const t of scanTasks(content)) {
				task.run(
					path,
					t.line,
					t.blockEnd,
					t.status,
					t.start ? minutes(t.start) : null,
					t.end ? minutes(t.end) : null,
					t.text,
					t.quadrant,
					t.fenced ? 1 : 0,
					t.raw,
					t.id,
					t.blockedBy.join(','),
					t.due
				);
				for (const tag of t.tags) taskTag.run(path, t.line, tag);
			}

			const link = this.db.prepare('INSERT INTO links (path,target,line,embed) VALUES (?,?,?,?)');
			for (const l of note.links) link.run(path, l.target, l.line, l.embed ? 1 : 0);

			const tag = this.db.prepare('INSERT OR REPLACE INTO tags (path,tag) VALUES (?,?)');
			for (const t of note.tags) tag.run(path, t);

			const heading = this.db.prepare('INSERT INTO headings (path,level,text,line) VALUES (?,?,?,?)');
			for (const h of note.headings) heading.run(path, h.level, h.text, h.line);

			this.db.prepare('INSERT INTO notes_fts (path,title,body) VALUES (?,?,?)').run(path, note.title, note.body);

			// Indexed like any other note — the markers are the user's to resolve,
			// and half a note is still worth searching — but recorded, so the
			// pages showing it can say the file is a merge that never finished.
			if (CONFLICT_START.test(content) && CONFLICT_END.test(content)) {
				this.db
					.prepare('INSERT OR REPLACE INTO problems (path, message) VALUES (?, ?)')
					.run(path, CONFLICT_MARKERS);
			}
		});
		run();
	}

	/** Remove every trace of a note. Safe for a path that was never indexed. */
	forget(path: string): void {
		for (const table of ['notes', 'tasks', 'task_tags', 'links', 'tags', 'headings', 'problems']) {
			this.db.prepare(`DELETE FROM ${table} WHERE path = ?`).run(path);
		}
		this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(path);
	}

	/** Replace the whole index from a list of notes. Returns how long it took. */
	rebuild(notes: Iterable<{ path: string; content: string; mtimeMs?: number; hash?: string }>): number {
		const started = Date.now();
		const run = this.db.transaction(() => {
			for (const table of ['notes', 'tasks', 'task_tags', 'links', 'tags', 'headings', 'problems', 'notes_fts']) {
				this.db.prepare(`DELETE FROM ${table}`).run();
			}
			for (const n of notes) this.put(n.path, n.content, n.mtimeMs ?? Date.now(), n.hash ?? '');
		});
		run();
		const took = Date.now() - started;
		this.setMeta('last_build_ms', String(took));
		this.setMeta('last_build_at', new Date().toISOString());
		return took;
	}

	/** Full-text search over titles and bodies, best matches first. */
	search(query: string, limit = 30): SearchHit[] {
		const trimmed = query.trim();
		if (!trimmed) return [];
		try {
			return this.db
				.prepare(
					`SELECT path, title, snippet(notes_fts, 2, '«', '»', '…', 12) AS snippet
					 FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
				)
				.all(ftsQuery(trimmed), limit) as SearchHit[];
		} catch {
			// A query FTS5 cannot parse is a miss, not a server error.
			return [];
		}
	}

	/**
	 * What is wrong with one note, or null when nothing is. `health()` answers
	 * the same question for the whole vault; this is for a page that is already
	 * showing a single note and needs to say so above it.
	 */
	problemFor(path: string): string | null {
		const row = this.db.prepare('SELECT message FROM problems WHERE path = ?').get(path) as
			| { message: string }
			| undefined;
		return row?.message ?? null;
	}

	/** Tasks in one note, in file order. */
	tasksIn(path: string): IndexedTask[] {
		return this.db
			.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.path = ? ORDER BY t.line`)
			.all(path)
			.map(toTask);
	}

	/**
	 * The one task query. Everything the app asks about tasks goes through it:
	 * a day's open work, a workspace board, the blocked lens, a tag lens.
	 *
	 * `tags` and `under` together say what counts as membership, and they are
	 * ORed: a task belongs if it carries one of the tags or lives under one of
	 * the paths. Every other option narrows the result.
	 *
	 * `excludePrefixes` exists for a specific reason: this vault's daily notes
	 * are copies of one template, so every past day contributes the same
	 * eighteen unfinished tasks. Listing them would bury the real work.
	 *
	 * `requireQuadrant` exists for another: a `- [ ]` inside a syllabus or a
	 * test plan is checklist notation, not a task. A quadrant is what marks a
	 * line the user actually intends to do.
	 */
	findTasks(opts: TaskQuery = {}): IndexedTask[] {
		const where: string[] = [];
		const params: unknown[] = [];

		if (!opts.includeFenced) where.push('t.fenced = 0');
		if (opts.statuses?.length) {
			where.push(`t.status IN (${opts.statuses.map(() => '?').join(',')})`);
			params.push(...opts.statuses);
		}
		if (opts.quadrant) {
			where.push('t.quadrant = ?');
			params.push(opts.quadrant);
		}
		if (opts.requireQuadrant) where.push('t.quadrant IS NOT NULL');
		if (opts.dueOnOrBefore) {
			where.push('t.due IS NOT NULL AND t.due <= ?');
			params.push(opts.dueOnOrBefore);
		}
		if (opts.blocked) where.push("t.blocked_by <> ''");
		if (opts.excludeDailyNotes) {
			where.push('t.path NOT GLOB ?');
			params.push(DAILY_NOTE_GLOB);
		}
		for (const prefix of opts.excludePrefixes ?? []) {
			where.push('t.path NOT LIKE ? ESCAPE \'\\\'');
			params.push(`${like(prefix)}%`);
		}

		const member: string[] = [];
		if (opts.tags?.length) {
			member.push(
				`EXISTS (SELECT 1 FROM task_tags g WHERE g.path = t.path AND g.line = t.line AND (${opts.tags
					.map(() => 'g.tag = ? OR g.tag LIKE ?')
					.join(' OR ')}))`
			);
			for (const tag of opts.tags) params.push(tag, `${like(tag)}/%`);
		}
		for (const folder of opts.under ?? []) {
			member.push('t.path LIKE ? ESCAPE \'\\\'');
			params.push(`${like(folder.replace(/\/$/, ''))}/%`);
		}
		if (member.length) where.push(`(${member.join(' OR ')})`);

		params.push(opts.limit ?? 500);
		return this.db
			.prepare(
				`SELECT ${TASK_COLUMNS} FROM tasks t
				 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
				 ORDER BY t.path, t.line LIMIT ?`
			)
			.all(...params)
			.map(toTask);
	}

	/**
	 * Notes in a set of folders, most recently changed first.
	 *
	 * The index already holds every note's title and modification time, so a
	 * widget listing "the notes in this workspace" has no reason to open the
	 * files. Omit `under` for the whole vault.
	 */
	notes(opts: { under?: string[]; excludePrefixes?: string[]; limit?: number } = {}): IndexedNote[] {
		const where: string[] = [];
		const params: unknown[] = [];
		const folders = (opts.under ?? []).map((f) => f.replace(/\/$/, ''));
		if (folders.length) {
			where.push(`(${folders.map(() => "path LIKE ? ESCAPE '\\'").join(' OR ')})`);
			params.push(...folders.map((f) => `${like(f)}/%`));
		}
		for (const prefix of opts.excludePrefixes ?? []) {
			where.push("path NOT LIKE ? ESCAPE '\\'");
			params.push(`${like(prefix)}%`);
		}
		params.push(opts.limit ?? 100);
		return this.db
			.prepare(
				`SELECT path, title, mtime_ms AS mtimeMs, bytes FROM notes
				 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
				 ORDER BY mtime_ms DESC LIMIT ?`
			)
			.all(...params) as IndexedNote[];
	}

	/**
	 * Tasks carrying the given Tasks-plugin ids, for resolving `\u26D4`
	 * dependencies. Unknown ids simply do not appear, so a blocker deleted from
	 * the vault leaves a dangling reference the UI can report rather than a
	 * crash.
	 */
	tasksByIds(ids: string[]): IndexedTask[] {
		if (!ids.length) return [];
		return this.db
			.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.task_id IN (${ids.map(() => '?').join(',')})`)
			.all(...ids)
			.map(toTask);
	}

	/** Notes linking to a note name, for the backlinks panel. */
	backlinks(noteName: string): Array<{ path: string; line: number }> {
		return this.db.prepare('SELECT path, line FROM links WHERE target = ? ORDER BY path').all(noteName) as Array<{
			path: string;
			line: number;
		}>;
	}

	/**
	 * Map a wikilink target to a note path, the way Obsidian does: an exact
	 * path wins, then a unique file name, then a case-insensitive file name.
	 * Returns null when nothing matches or the name is ambiguous, so the UI can
	 * show an unresolved link instead of guessing wrong.
	 */
	resolveLink(target: string): string | null {
		const name = target.endsWith('.md') ? target : `${target}.md`;
		const exact = this.db.prepare('SELECT path FROM notes WHERE path = ?').get(name) as { path: string } | undefined;
		if (exact) return exact.path;

		const rows = this.db
			.prepare("SELECT path FROM notes WHERE path = ? OR path LIKE ? ESCAPE '\\'")
			.all(name, `%/${like(name)}`) as Array<{ path: string }>;
		if (rows.length === 1) return rows[0].path;
		if (rows.length > 1) return rows.sort((a, b) => a.path.length - b.path.length)[0].path;

		const lower = name.toLowerCase();
		const all = this.db.prepare('SELECT path FROM notes').all() as Array<{ path: string }>;
		const match = all.filter((r) => (r.path.split('/').pop() ?? '').toLowerCase() === lower);
		return match.length ? match.sort((a, b) => a.path.length - b.path.length)[0].path : null;
	}

	noteTitle(path: string): string | null {
		const row = this.db.prepare('SELECT title FROM notes WHERE path = ?').get(path) as { title: string } | undefined;
		return row?.title ?? null;
	}

	health(): IndexHealth {
		const count = (t: string) => (this.db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
		const lastBuild = this.getMeta('last_build_ms');
		return {
			notes: count('notes'),
			tasks: count('tasks'),
			links: count('links'),
			tags: count('tags'),
			problems: this.db.prepare('SELECT path, message FROM problems ORDER BY path').all() as Array<{
				path: string;
				message: string;
			}>,
			lastBuildMs: lastBuild ? Number(lastBuild) : null
		};
	}

	close(): void {
		this.db.close();
	}

	/**
	 * The index is a cache, so an old schema is thrown away rather than
	 * migrated. Every table is rebuilt from the markdown at the next boot, which
	 * the hub always does, so nothing is lost by dropping them.
	 */
	private migrate(): void {
		this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		if (this.getMeta('schema_version') === String(SCHEMA_VERSION)) return;
		const objects = this.db
			.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%'")
			.all() as Array<{ name: string; type: string }>;
		for (const o of objects) {
			if (o.name === 'meta') continue;
			this.db.exec(`DROP ${o.type === 'index' ? 'INDEX' : 'TABLE'} IF EXISTS "${o.name}"`);
		}
		this.db.prepare('DELETE FROM meta').run();
	}

	private setMeta(key: string, value: string): void {
		this.db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(key, value);
	}

	private getMeta(key: string): string | null {
		const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
		return row?.value ?? null;
	}
}

function toTask(row: any): IndexedTask {
	return {
		tags: row.tags ? String(row.tags).split(' ').filter(Boolean) : [],
		id: row.task_id ?? null,
		blockedBy: row.blocked_by ? String(row.blocked_by).split(',').filter(Boolean) : [],
		due: row.due ?? null,
		path: row.path,
		line: row.line,
		blockEnd: row.block_end,
		status: row.status,
		startMin: row.start_min,
		endMin: row.end_min,
		text: row.text,
		quadrant: row.quadrant,
		fenced: row.fenced === 1,
		raw: row.raw
	};
}

/** Escape the wildcards SQLite LIKE would otherwise interpret. */
function like(value: string): string {
	return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function minutes(hhmm: string): number {
	const [h, m] = hhmm.split(':');
	return Number(h) * 60 + Number(m);
}

/**
 * Turn user text into an FTS5 query. Words become a prefix-matched AND, which
 * is what someone typing into a search box expects; FTS5 operator characters
 * are dropped rather than passed through, so a stray quote is not a syntax
 * error.
 */
export function ftsQuery(input: string): string {
	const words = input
		.replace(/["^*():\-]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return '""';
	return words.map((w) => `"${w}"*`).join(' AND ');
}

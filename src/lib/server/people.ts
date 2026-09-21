/**
 * People: the vault's lightweight CRM.
 *
 * A person is a note, `People/<Full Name>.md`, and a connection to them is a
 * wiki-link. Mentioning `[[Ada Lovelace]]` in a meeting note is all it takes for
 * that note to appear on her page, and a task whose block mentions her is a
 * follow-up. Nothing hub-specific is added to anyone else's note.
 *
 *     ---
 *     type: person
 *     ---
 *     ## Follow-ups
 *     - [ ] Send the anonymisation plan `Q2`
 *
 *     ## Log
 *     - 2026-09-18 Agreed the byte-level approach.
 *
 * Two decisions worth stating:
 *
 *  - **A person with no note reads as a person with an empty note.** Following a
 *    wiki-link to someone you have never written about opens their page, shows
 *    who mentioned them, and lets you log the first contact, which is what
 *    creates the note. No error, no "create person" step.
 *  - **`last_contact` in frontmatter is read but never written.** Writing it
 *    would mean rewriting an existing line, and the newest dated line under
 *    `## Log` already says the same thing. Last contact is derived: the latest
 *    of their log lines, that field if someone set it by hand, and the newest
 *    daily note that links to them.
 *
 * Who appears in a list is decided by who has a note. The alternative — reading
 * every note in scope and treating capitalised unresolved links as people — was
 * rejected: the index can say who links to a name but cannot enumerate the
 * links out of a folder, so it would mean a full scan on every page load, and
 * a link to a book or an idea — `[[Some Book Title]]`, `[[Some Concept]]` —
 * would be filed as a friend.
 */

import { basename, parseNote } from './parse/note';
import { appendUnderHeading } from './sections';
import { dayOfNote, today, type DayKey } from './daily';
import { config } from './config';
import type { NoteIndex } from './index/index';
import type { Vault } from './vault/index';
import { hashContent } from './vault/index';
import { isOpen, type Task } from '../shared/task';

/** Where person notes live. The vault layout is `config.ts`'s to state. */
export const PEOPLE_FOLDER = config.peopleFolder;

const LOG_HEADING = '## Log';
const FOLLOW_UPS_HEADING = '## Follow-ups';
const LOG_LINE = /^[ \t]*[-*+][ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(.*)$/;

/** Enough about a person for a list: who to talk to next, and when you last did. */
export interface PersonSummary {
	name: string;
	/** Their note, or null when nobody has written one yet. */
	path: string | null;
	lastContact: DayKey | null;
	openFollowUps: number;
	/** The soonest due date among those follow-ups, or null when none is dated. */
	nextDue: string | null;
	/** How many notes link to them. */
	mentions: number;
	/** Their role and organisation, when the note gives them. */
	role: string | null;
	org: string | null;
}

/** One line of a person's `## Log`, in the order the file has them. */
export interface LogLine {
	/** The date the line starts with, or null for a line written without one. */
	day: DayKey | null;
	text: string;
	line: number;
}

/** Everything a person's page shows. */
export interface Person extends PersonSummary {
	path: string;
	/** False when they have no note; every other field still reads normally. */
	exists: boolean;
	/** The note's body, frontmatter removed, for rendering. */
	body: string;
	frontmatter: Record<string, unknown>;
	followUps: Task[];
	log: LogLine[];
	mentionedIn: Array<{ path: string; title: string; line: number }>;
}

/**
 * Which people a list is about. An empty scope means the whole vault; a
 * workspace passes its folders, its tag and its slug, and a person belongs when
 * their note or any note that mentions them sits inside it.
 */
export interface PeopleScope {
	folders?: string[];
	tags?: string[];
	slug?: string;
}

/** Vault-relative path of a person's note. Path separators are not names. */
export function personPath(name: string): string {
	return `${PEOPLE_FOLDER}/${personName(name)}.md`;
}

/** A name reduced to what may appear in a file name, or '' when nothing is left. */
export function personName(name: string): string {
	return name
		.replace(/\.md$/i, '')
		.replace(/[\\/:*?"<>|]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[.\s]+|[.\s]+$/g, '');
}

/**
 * The people in scope, the ones needing attention first.
 *
 * Ordered so the list reads as a prompt to act: anyone with a dated follow-up
 * first, soonest due first, then anyone else with follow-ups, then by how long
 * it has been since you last spoke, oldest first. Ties break on the name so the
 * order never wobbles between loads.
 *
 * Reads each person's note. Writes nothing. A person whose note is unreadable
 * still appears, with no follow-ups, rather than disappearing from the list.
 */
export async function listPeople(vault: Vault, index: NoteIndex, scope: PeopleScope = {}): Promise<PersonSummary[]> {
	const paths = (await vault.list()).filter((p) => p.startsWith(`${PEOPLE_FOLDER}/`));
	const people: PersonSummary[] = [];

	for (const path of paths) {
		const name = basename(path);
		const note = await vault.read(path);
		const parsed = parseNote(note.content, path);
		const links = index.backlinks(name);
		if (!inScope(scope, path, parsed.frontmatter, parsed.tags, links)) continue;

		const followUps = followUpsFor(index, name, path);
		people.push({
			name,
			path,
			lastContact: lastContact(parsed.frontmatter, readLog(note.content), links),
			openFollowUps: followUps.length,
			nextDue: followUps.map((t) => t.due).filter((d): d is string => !!d).sort()[0] ?? null,
			mentions: new Set(links.map((l) => l.path)).size,
			role: text(parsed.frontmatter.role),
			org: text(parsed.frontmatter.org)
		});
	}

	return people.sort(byAttention);
}

/**
 * One person, whether or not anybody has written a note about them.
 *
 * Their note is found by the same rule Obsidian resolves a wiki-link by, so
 * someone filed outside the people folder is still found. Reads; writes
 * nothing.
 */
export async function person(vault: Vault, index: NoteIndex, rawName: string): Promise<Person> {
	const name = personName(rawName);
	const path = index.resolveLink(name) ?? personPath(name);
	const note = await vault.read(path);
	const parsed = parseNote(note.content, path);
	const links = index.backlinks(name).filter((l) => l.path !== path);
	const followUps = followUpsFor(index, name, path);
	const log = readLog(note.content);

	return {
		name,
		path,
		exists: note.exists,
		body: parsed.body,
		frontmatter: parsed.frontmatter,
		followUps,
		log,
		mentionedIn: dedupe(links).map((l) => ({
			path: l.path,
			line: l.line,
			title: index.noteTitle(l.path) ?? basename(l.path)
		})),
		lastContact: lastContact(parsed.frontmatter, log, links),
		openFollowUps: followUps.length,
		nextDue: followUps.map((t) => t.due).filter((d): d is string => !!d).sort()[0] ?? null,
		mentions: new Set(links.map((l) => l.path)).size,
		role: text(parsed.frontmatter.role),
		org: text(parsed.frontmatter.org)
	};
}

export type ContactLogged =
	| { ok: true; path: string; line: number; day: DayKey; created: boolean }
	| { ok: false; reason: 'no-name' | 'no-text' | 'conflict' };

/**
 * Append one dated line to a person's `## Log`, creating their note when they
 * have none.
 *
 * Append-only, like every other write in this app: an existing note is added to
 * and never replaced, no existing line is touched, and the `last_contact` field
 * is deliberately left as the user wrote it. Creating refuses rather than
 * overwrites, the way `createWorkspace` does, so a note that appeared in the
 * moment between reading and writing keeps its contents.
 */
export async function logContact(
	vault: Vault,
	rawName: string,
	rawText: string,
	day: DayKey = today()
): Promise<ContactLogged> {
	const name = personName(rawName);
	const text = rawText.replace(/\s+/g, ' ').trim();
	if (!name) return { ok: false, reason: 'no-name' };
	if (!text) return { ok: false, reason: 'no-text' };

	const path = personPath(name);
	const note = await vault.read(path);
	const base = note.exists ? note.content : newPersonNote(name);
	const next = appendUnderHeading(base, LOG_HEADING, `- ${day} ${text}`);

	// An empty-content hash means "I believe this file does not exist"; the
	// vault turns a file that appeared underneath into a refusal rather than an
	// overwrite.
	const result = await vault.write(path, next.content, note.exists ? note.hash : hashContent(''));
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, path, line: next.line, day, created: !note.exists };
}

/**
 * Open tasks that belong to a person: everything still open in their own note,
 * and any open task elsewhere whose block mentions them.
 *
 * A mention on one of a task's own sub-bullets counts, because those lines
 * belong to the task and travel with it.
 */
function followUpsFor(index: NoteIndex, name: string, path: string): Task[] {
	const found = new Map<string, Task>();
	const key = (t: Task) => `${t.path}:${t.line}`;

	for (const task of index.tasksIn(path)) {
		if (!task.fenced && isOpen(task)) found.set(key(task), task);
	}
	for (const link of index.backlinks(name)) {
		if (link.path === path) continue;
		for (const task of index.tasksIn(link.path)) {
			if (task.fenced || !isOpen(task)) continue;
			if (link.line >= task.line && link.line <= task.blockEnd) found.set(key(task), task);
		}
	}
	return [...found.values()].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}

/** The `- YYYY-MM-DD ...` lines under `## Log`, in file order. */
function readLog(content: string): LogLine[] {
	const lines = content.split('\n');
	const out: LogLine[] = [];
	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		if (/^[ \t]*#{1,6}[ \t]/.test(lines[i])) {
			inSection = lines[i].trim().toLowerCase() === LOG_HEADING.toLowerCase();
			continue;
		}
		if (!inSection || !lines[i].trim()) continue;
		const m = LOG_LINE.exec(lines[i]);
		if (m) out.push({ day: m[1], text: m[2].trim(), line: i });
		else out.push({ day: null, text: lines[i].replace(/^[ \t]*[-*+][ \t]+/, '').trim(), line: i });
	}
	return out;
}

/**
 * The most recent date anything says you spoke to them. A mention in an undated
 * note cannot date a contact, which is why a log line is the better record.
 */
function lastContact(
	frontmatter: Record<string, unknown>,
	log: LogLine[],
	links: Array<{ path: string }>
): DayKey | null {
	const days = [
		...log.map((l) => l.day),
		asDay(frontmatter.last_contact),
		...links.map((l) => dayOfNote(l.path))
	].filter((d): d is DayKey => !!d);
	return days.sort().at(-1) ?? null;
}

function inScope(
	scope: PeopleScope,
	path: string,
	frontmatter: Record<string, unknown>,
	tags: string[],
	links: Array<{ path: string }>
): boolean {
	const folders = scope.folders ?? [];
	const scopeTags = scope.tags ?? [];
	if (!folders.length && !scopeTags.length && !scope.slug) return true;

	const under = (p: string) => folders.some((f) => p === f || p.startsWith(`${f.replace(/\/$/, '')}/`));
	if (under(path) || links.some((l) => under(l.path))) return true;
	if (scopeTags.some((t) => tags.includes(t) || tags.some((own) => own.startsWith(`${t}/`)))) return true;

	if (scope.slug) {
		const declared = frontmatter.workspaces ?? frontmatter.workspace;
		const list = Array.isArray(declared) ? declared : [declared];
		if (list.some((v) => typeof v === 'string' && v === scope.slug)) return true;
	}
	return false;
}

/** The order a list of people reads best in. See `listPeople`. */
function byAttention(a: PersonSummary, b: PersonSummary): number {
	const rank = (p: PersonSummary) => (p.nextDue ? 0 : p.openFollowUps ? 1 : 2);
	if (rank(a) !== rank(b)) return rank(a) - rank(b);
	if (a.nextDue && b.nextDue && a.nextDue !== b.nextDue) return a.nextDue.localeCompare(b.nextDue);
	if (a.openFollowUps !== b.openFollowUps) return b.openFollowUps - a.openFollowUps;
	if (a.lastContact !== b.lastContact) return (a.lastContact ?? '').localeCompare(b.lastContact ?? '');
	return a.name.localeCompare(b.name);
}

/** The note a first contact creates: their name, the two headings, nothing else. */
function newPersonNote(name: string): string {
	return `---\ntype: person\n---\n\n# ${name}\n\n${FOLLOW_UPS_HEADING}\n\n${LOG_HEADING}\n`;
}

function dedupe(links: Array<{ path: string; line: number }>): Array<{ path: string; line: number }> {
	const seen = new Set<string>();
	return links.filter((l) => (seen.has(l.path) ? false : seen.add(l.path)));
}

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** YAML turns a bare date into a Date; both spellings mean the same day. */
function asDay(value: unknown): DayKey | null {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

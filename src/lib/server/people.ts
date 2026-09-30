/**
 * People: anyone the vault's notes link to.
 *
 * A person is a note, `People/<Full Name>.md`, and a connection to them is a
 * wiki-link. Mentioning `[[Ada Lovelace]]` in a note is all it takes for
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
 * There is no list of people. A workspace's contacts are its CRM (`crm.ts`),
 * a separate set of notes; a person here is reached by following a link.
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

/** One line of a person's `## Log`, in the order the file has them. */
interface LogLine {
	/** The date the line starts with, or null for a line written without one. */
	day: DayKey | null;
	text: string;
	line: number;
}

/** Everything a person's page shows. */
export interface Person {
	name: string;
	path: string;
	/** False when they have no note; every other field still reads normally. */
	exists: boolean;
	lastContact: DayKey | null;
	openFollowUps: number;
	/** The soonest due date among those follow-ups, or null when none is dated. */
	nextDue: string | null;
	/** How many notes link to them. */
	mentions: number;
	/** Their role and organisation, when the note gives them. */
	role: string | null;
	org: string | null;
	/** The note's body, frontmatter removed, for rendering. */
	body: string;
	frontmatter: Record<string, unknown>;
	followUps: Task[];
	log: LogLine[];
	mentionedIn: Array<{ path: string; title: string; line: number }>;
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

type ContactLogged =
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

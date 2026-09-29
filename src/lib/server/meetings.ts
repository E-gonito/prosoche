/**
 * Meetings: a workspace's primer, its meeting notes and its glossary, and the
 * calendar events that lead into them.
 *
 * The Meetings routes talk to this module and nothing else in the core. It
 * owns where a workspace keeps its meeting files, which workspace an event
 * belongs to, and every write the notebook makes on a user's click: starting
 * a meeting, capturing a line, ending it, adding a glossary term, remembering
 * an event's workspace. Each of those is an insertion or a one-line rewrite
 * through the grammars in `parse/`; none re-serialises a note.
 *
 * A workspace's home is its first folder:
 *
 *     <home>/Primer.md        the meeting card, free markdown
 *     <home>/Glossary.md      one `##` heading per term
 *     <home>/Log.md           dated updates, read as context for drafts
 *     <home>/Meetings/*.md    one note per meeting
 *
 * Every read here is public scope, so nothing under the private folder is
 * ever seen, and nothing here writes on a model's behalf: the drafts that do
 * are proposals, in `ai/meeting-drafts.ts`.
 */

import { config } from './config';
import { appendUnderHeading } from './sections';
import { basename, parseNote } from './parse/note';
import { renderMarkdown } from './render';
import { scanTasks, toTask } from './parse/task';
import {
	CAPTURED_HEADING,
	actionText,
	formatCaptured,
	meetingPath,
	newMeetingNote,
	readMeeting,
	setEnded,
	type CaptureInput
} from './parse/meeting';
import { appendEntry, normaliseTerm, parseGlossary, type GlossaryEntry } from './parse/glossary';
import { parseMeetingMap, setMapping, slugForTitle, type MeetingMapping } from './parse/meeting-map';
import { workspaceFor, type Workspace } from './workspaces';
import type { CalendarEvent } from './calendar';
import type { Vault } from './vault/index';
import type { EventRow, MeetingSummary, MeetingType, OpenAction } from '$lib/shared/meetings';

/** Where the event-title → workspace mapping lives. */
export const MEETING_MAP_PATH = `${config.hubFolder}/meetings.md`;

/** A meeting note as read, with what a write back needs. */
export interface Meeting extends MeetingSummary {
	content: string;
	hash: string;
	mtimeMs: number;
}

/** The outcome of a notebook write. A clash is a result, not an exception. */
export type Written =
	| { ok: true; path: string }
	| { ok: false; reason: 'conflict' | 'not-found' | 'invalid'; message: string };

/** The files a workspace's notebook is made of, vault-relative. */
export interface NotebookPaths {
	home: string;
	primer: string;
	glossary: string;
	log: string;
	/** The folder meeting notes go in, without a trailing slash. */
	meetings: string;
}

/**
 * The notebook's files for a workspace, or null for a workspace with no
 * folder, which has nowhere to keep them.
 */
export function notebookPaths(workspace: Workspace): NotebookPaths | null {
	const home = workspace.folders[0]?.replace(/^\/+|\/+$/g, '');
	if (!home) return null;
	return {
		home,
		primer: `${home}/Primer.md`,
		glossary: `${home}/Glossary.md`,
		log: `${home}/Log.md`,
		meetings: `${home}/Meetings`
	};
}

/** True for a note directly inside the notebook's Meetings folder. */
export function isMeetingNote(paths: NotebookPaths, path: string): boolean {
	if (!path.startsWith(`${paths.meetings}/`) || !path.endsWith('.md')) return false;
	const rest = path.slice(paths.meetings.length + 1);
	return rest.length > 3 && !rest.includes('/') && !rest.startsWith('.');
}

/**
 * Every meeting note in the notebook, newest first: by date, then by the
 * note most recently written. Never throws; an empty folder is an empty list.
 */
export async function loadMeetings(vault: Vault, paths: NotebookPaths): Promise<Meeting[]> {
	const found = (await vault.list()).filter((p) => isMeetingNote(paths, p));
	const meetings: Meeting[] = [];
	for (const path of found) {
		const note = await vault.read(path);
		if (!note.exists) continue;
		meetings.push({ path, ...readMeeting(note.content, path), content: note.content, hash: note.hash, mtimeMs: note.mtimeMs });
	}
	return meetings.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.mtimeMs - a.mtimeMs);
}

/** A meeting without the bytes, for a page. */
export function summarise(meeting: Meeting): MeetingSummary {
	const { path, title, type, date, ended, event, attendees, captured } = meeting;
	return { path, title, type, date, ended, event, attendees, captured };
}

/**
 * The meeting under way: today's most recently written note that has not
 * been ended. Null when there is none, including a note dated another day
 * that was never ended, which is simply a past meeting.
 */
export function currentMeeting(meetings: Meeting[], today: string): Meeting | null {
	return meetings.find((m) => m.date === today && m.ended === null) ?? null;
}

/**
 * Open task lines from every meeting note, newest meeting first and in file
 * order within one. Fenced lines are text, not tasks, and are left out.
 */
export function openActions(meetings: Meeting[]): OpenAction[] {
	const out: OpenAction[] = [];
	for (const meeting of meetings) {
		for (const line of scanTasks(meeting.content)) {
			if (line.fenced || line.status === 'done' || line.status === 'cancelled') continue;
			out.push({
				task: toTask(line, meeting.path),
				text: actionText(line.text),
				source: { path: meeting.path, title: meeting.title, date: meeting.date }
			});
		}
	}
	return out;
}

/** What starting a meeting needs. */
export interface StartInput {
	type: MeetingType;
	title: string;
	/** `YYYY-MM-DD`; the note is named and dated by it. */
	date: string;
	event?: string | null;
	attendees?: string[];
}

/**
 * Create a meeting note from the template and return its path.
 *
 * Never overwrites: a second meeting with the same title on the same day
 * gets " 2" after its name. A user action, so it writes directly.
 */
export async function startMeeting(vault: Vault, paths: NotebookPaths, input: StartInput): Promise<Written> {
	const taken = (await vault.list()).filter((p) => isMeetingNote(paths, p));
	const path = meetingPath(paths.meetings, input.date, input.title, taken);
	const title = input.title.trim() || (input.type === 'standup' ? 'Standup' : 'Meeting');
	if ((await vault.read(path)).exists) return conflict();
	const result = await vault.write(path, newMeetingNote({ ...input, title }));
	return result.ok ? { ok: true, path } : conflict();
}

/**
 * Append one captured line under `## Captured` in a meeting note.
 *
 * Refuses a path outside the notebook's Meetings folder and an empty
 * capture. An append is safe to redo, so a clash with an edit made a moment
 * earlier is retried once against the new text before it is reported.
 */
export async function captureItem(vault: Vault, paths: NotebookPaths, path: string, input: CaptureInput): Promise<Written> {
	if (!isMeetingNote(paths, path)) return invalid('That is not a meeting note in this workspace.');
	if (!input.text.trim()) return invalid('Nothing to capture.');
	const line = formatCaptured(input);
	return rewrite(vault, path, (content) => appendUnderHeading(content, CAPTURED_HEADING, line).content, 2);
}

/**
 * Mark a meeting ended at `time` (`HH:MM`), which rewrites or inserts the one
 * `ended:` line of its frontmatter and nothing else.
 */
export async function endMeeting(vault: Vault, paths: NotebookPaths, path: string, time: string): Promise<Written> {
	if (!isMeetingNote(paths, path)) return invalid('That is not a meeting note in this workspace.');
	if (!/^\d{2}:\d{2}$/.test(time)) return invalid('A time is HH:MM.');
	return rewrite(vault, path, (content) => setEnded(content, time), 1);
}

/** A term captured in a meeting that the glossary does not have yet. */
export interface CapturedTerm {
	term: string;
	guess: string | null;
	/** `[[<meeting note name>]]`, as the glossary's `source::` wants it. */
	source: string;
	meeting: { path: string; title: string; date: string | null };
}

/**
 * The glossary's entries and the captured terms it is missing.
 *
 * A term captured in several meetings is offered once, from the newest. A
 * missing Glossary.md is an empty glossary.
 */
export async function loadGlossary(
	vault: Vault,
	paths: NotebookPaths,
	meetings: Meeting[]
): Promise<{ exists: boolean; content: string; entries: GlossaryEntry[]; captured: CapturedTerm[] }> {
	const note = await vault.read(paths.glossary);
	const entries = parseGlossary(note.content);
	const known = new Set(entries.map((e) => normaliseTerm(e.term)));
	const captured: CapturedTerm[] = [];
	for (const meeting of meetings) {
		for (const item of meeting.captured) {
			const key = normaliseTerm(item.text);
			if (item.kind !== 'term' || !key || known.has(key)) continue;
			known.add(key);
			captured.push({
				term: item.text,
				guess: item.guess,
				source: `[[${basename(meeting.path)}]]`,
				meeting: { path: meeting.path, title: meeting.title, date: meeting.date }
			});
		}
	}
	return { exists: note.exists, content: note.content, entries, captured };
}

/**
 * Append a new glossary entry, status to-look-up. Creates Glossary.md when
 * there is none. Refuses a term the glossary already has, rather than
 * writing a second heading for it.
 */
export async function addGlossaryTerm(
	vault: Vault,
	paths: NotebookPaths,
	term: { term: string; guess?: string | null; source?: string | null }
): Promise<Written> {
	if (!term.term.trim()) return invalid('A term needs a name.');
	return rewrite(
		vault,
		paths.glossary,
		(content) => {
			const key = normaliseTerm(term.term);
			if (parseGlossary(content).some((e) => normaliseTerm(e.term) === key)) return null;
			return appendEntry(content, { term: term.term, guess: term.guess, source: term.source, status: 'to-look-up' });
		},
		2,
		{ create: true, unchanged: 'That term is already in the glossary.' }
	);
}

/** Every event-title mapping in `_hub/meetings.md`. A missing file maps nothing. */
export async function loadAssignments(vault: Vault): Promise<MeetingMapping[]> {
	return parseMeetingMap((await vault.read(MEETING_MAP_PATH)).content);
}

/**
 * Remember that events called `title` belong to workspace `slug`. Rewrites
 * only that title's line, or appends one; creates the file when needed.
 * Refuses a slug that names no workspace.
 */
export async function assignTitle(vault: Vault, workspaces: Workspace[], title: string, slug: string): Promise<Written> {
	if (!title.trim()) return invalid('An event needs a title to be remembered by.');
	if (!workspaces.some((w) => w.slug === slug)) return invalid('No such workspace.');
	return rewrite(vault, MEETING_MAP_PATH, (content) => setMapping(content, title, slug), 2, { create: true });
}

/**
 * Calendar events grouped by day, each with its workspace. Pure.
 *
 * An assigned title shows its workspace. An unassigned one whose words name a
 * workspace alias carries that workspace as a suggestion only: nothing is
 * assigned until the user clicks. A mapping to a workspace that no longer
 * exists counts as unassigned.
 */
export function planEvents(
	events: CalendarEvent[],
	mappings: MeetingMapping[],
	workspaces: Workspace[]
): Array<{ day: string; events: EventRow[] }> {
	const days = new Map<string, EventRow[]>();
	for (const event of events) {
		const mapped = slugForTitle(mappings, event.title);
		const workspace = mapped && workspaces.some((w) => w.slug === mapped) ? mapped : null;
		const suggestion = workspace ? null : (workspaceFor(workspaces, { path: '', text: event.title })?.slug ?? null);
		const row: EventRow = {
			id: event.id,
			title: event.title,
			day: event.day,
			startMin: event.startMin,
			endMin: event.endMin,
			attendees: event.attendees,
			location: event.location,
			link: event.link,
			workspace,
			suggestion
		};
		days.set(event.day, [...(days.get(event.day) ?? []), row]);
	}
	return [...days.entries()].map(([day, rows]) => ({ day, events: rows }));
}

/**
 * The event a notebook's Start meeting should be prefilled from: today's
 * event assigned to `slug` that is under way at `nowMin`, else the next one
 * to start. All-day events never count. Pure.
 */
export function eventForNotebook(
	events: CalendarEvent[],
	mappings: MeetingMapping[],
	slug: string,
	today: string,
	nowMin: number
): CalendarEvent | null {
	const mine = events.filter((e) => e.day === today && e.startMin !== null && slugForTitle(mappings, e.title) === slug);
	const running = mine.find((e) => e.startMin! <= nowMin && nowMin < (e.endMin ?? e.startMin! + 1));
	if (running) return running;
	return mine.filter((e) => e.startMin! > nowMin).sort((a, b) => a.startMin! - b.startMin!)[0] ?? null;
}

/** One part of a primer section: prose on paper, or an aside in sand. */
export interface PrimerBlock {
	kind: 'text' | 'callout';
	html: string;
}

/** A primer section: the lead has no heading, the rest are `##` sections. */
export interface PrimerSection {
	heading: string | null;
	blocks: PrimerBlock[];
}

const FENCE = /^[ \t]*(```|~~~)/;

/**
 * A primer, cut into the shape the meeting card draws. Pure.
 *
 * The note is split at its `##` headings; the part before the first is the
 * lead. The note's own `# Title` is dropped, because the page already has
 * one. Within each part, a run of `>` lines becomes a callout and everything
 * else a text block, each rendered as markdown. Headings inside fences are
 * text.
 */
export function primerView(markdown: string, resolve: (target: string) => string | null = () => null): PrimerSection[] {
	const lines = parseNote(markdown).body.split('\n');
	const sections: Array<{ heading: string | null; lines: string[] }> = [{ heading: null, lines: [] }];
	let fence: string | null = null;
	let seenContent = false;
	for (const raw of lines) {
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
		}
		if (fence === null && !f) {
			if (!seenContent && /^#[ \t]/.test(raw)) {
				seenContent = true;
				continue;
			}
			const h2 = /^##[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(raw);
			if (h2) {
				sections.push({ heading: h2[1], lines: [] });
				seenContent = true;
				continue;
			}
		}
		if (raw.trim()) seenContent = true;
		sections[sections.length - 1].lines.push(raw);
	}

	return sections
		.map(({ heading, lines: body }) => ({ heading, blocks: blocksOf(body, resolve) }))
		.filter((s) => s.heading !== null || s.blocks.length > 0);
}

function blocksOf(lines: string[], resolve: (target: string) => string | null): PrimerBlock[] {
	const runs: Array<{ kind: PrimerBlock['kind']; lines: string[] }> = [];
	let fence: string | null = null;
	for (const raw of lines) {
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
		}
		const quoted = fence === null && !f && /^[ \t]{0,3}>/.test(raw);
		const kind = quoted ? 'callout' : 'text';
		const text = quoted ? raw.replace(/^[ \t]{0,3}>[ \t]?/, '') : raw;
		const last = runs[runs.length - 1];
		if (last && last.kind === kind) last.lines.push(text);
		else runs.push({ kind, lines: [text] });
	}
	return runs
		.filter((r) => r.lines.some((l) => l.trim()))
		.map((r) => ({ kind: r.kind, html: renderMarkdown(r.lines.join('\n'), resolve) }));
}

/** A custom HTML page of a workspace, shown as a notebook tab. */
export interface CustomPage {
	file: string;
	title: string;
	href: string;
}

/**
 * The workspace's `<home>/Pages/*.html`, each a tab served by the Workspaces
 * module at `/w/<slug>/pages/<file>`.
 */
export async function customPages(vault: Vault, workspace: Workspace): Promise<CustomPage[]> {
	const paths = notebookPaths(workspace);
	if (!paths) return [];
	// TODO(lead): switch to vault.files after merge, e.g.
	// `(await vault.files(`${paths.home}/Pages`, '.html')).map(basenameOfPath)`.
	void vault;
	const files: string[] = [];
	return files.map((file) => ({ file, title: pageTitle(file), href: `/w/${workspace.slug}/pages/${encodeURIComponent(file)}` }));
}

/** A page title for a custom page file: `eye-3d.html` → `Eye 3d`. */
export function pageTitle(file: string): string {
	const stem = file.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ').trim();
	return stem ? stem[0].toUpperCase() + stem.slice(1) : file;
}

/* ------------------------------------------------------------- plumbing -- */

/**
 * Read, change, write with the hash just read, and retry on a clash.
 *
 * `change` returns the new text, or null when there is nothing to do, which
 * is reported with `unchanged` as its message. A missing note is refused
 * unless `create` says a note may start empty.
 */
async function rewrite(
	vault: Vault,
	path: string,
	change: (content: string) => string | null,
	attempts: number,
	opts: { create?: boolean; unchanged?: string } = {}
): Promise<Written> {
	for (let i = 0; i < attempts; i++) {
		const note = await vault.read(path);
		if (!note.exists && !opts.create) return { ok: false, reason: 'not-found', message: 'That note is not there any more.' };
		const next = change(note.content);
		if (next === null) return invalid(opts.unchanged ?? 'Nothing to change.');
		if (next === note.content && note.exists) return { ok: true, path };
		const result = await vault.write(path, next, note.hash);
		if (result.ok) return { ok: true, path };
	}
	return conflict();
}

function invalid(message: string): Written {
	return { ok: false, reason: 'invalid', message };
}

function conflict(): Written {
	return { ok: false, reason: 'conflict', message: 'That note changed on another device. Reload and try again.' };
}

/**
 * The meeting note grammar: its template, its captured lines, and the one
 * frontmatter line a meeting ever rewrites.
 *
 * A meeting note is `<home>/Meetings/YYYY-MM-DD <Title>.md`:
 *
 *     ---
 *     type: meeting
 *     date: 2026-09-29
 *     event: abc123@google.com/2026-09-29
 *     attendees: [Ana, Ben]
 *     ---
 *     # Dev Weekly Meeting
 *
 *     ## Captured
 *     - term:: Cookie Cutter guess:: something for AI models
 *     - question:: Is the ensemble versioned as one artifact?
 *     - decision:: Deploy to ECS, not Beanstalk
 *     - [ ] action:: Clarify scope with the manager
 *     - A plain note
 *
 * Nothing outside this file knows those shapes. Everything here is pure, and
 * no function re-serialises a note: new lines are formatted here and inserted
 * by the caller, and `setEnded` changes exactly one line.
 */

import { basename, parseNote } from './note';
import { parseTaskLine } from './task';
import type { CaptureKind, CapturedItem, MeetingType } from '$lib/shared/meetings';

export { CAPTURE_KINDS } from '$lib/shared/meetings';
export type { CaptureKind, CapturedItem, MeetingType };

/** The heading captured items live under. */
export const CAPTURED_HEADING = '## Captured';
/** The heading drafted talking points live under. */
export const TALKING_POINTS_HEADING = '## Talking points';

/** What a caller asks to capture. Formatted by `formatCaptured`. */
export interface CaptureInput {
	kind: CaptureKind;
	text: string;
	guess?: string;
}

/** A meeting note, as the notebook shows it. */
interface MeetingMeta {
	title: string;
	type: MeetingType;
	/** `YYYY-MM-DD`, from the file name first and the frontmatter second. */
	date: string | null;
	/** The calendar event id the note was started from, or null. */
	event: string | null;
	attendees: string[];
	/** `HH:MM` the meeting was ended at, as written; null while it runs. */
	ended: string | null;
	captured: CapturedItem[];
}

const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^#{1,6}[ \t]/;
const BULLET = /^([-*+])[ \t]+(.*)$/;
const FIELD = /^(term|question|decision|action)::[ \t]*(.*)$/i;
const GUESS = /[ \t]+guess::[ \t]*/i;
const DATED_NAME = /^(\d{4}-\d{2}-\d{2})[ \t]+(.+)$/;

/**
 * Read one captured line. Returns null for anything that is not a top-level
 * bullet: blank lines, prose, indented sub-bullets and headings.
 *
 * Pure. A checkbox line is always an action, with or without the `action::`
 * marker, because a task under Captured is something to do whatever it says.
 * A bullet with no recognised marker is a note, so nothing written under the
 * heading by hand is lost from the notebook.
 */
export function parseCaptured(raw: string, line = 0): CapturedItem | null {
	const text = raw.replace(/\r$/, '');
	const task = parseTaskLine(text, line);
	if (task) {
		if (task.indent !== '') return null;
		return { kind: 'action', text: actionText(task.text), guess: null, done: task.status === 'done', line };
	}

	const bullet = BULLET.exec(text);
	if (!bullet) return null;
	const body = bullet[2].trim();
	const field = FIELD.exec(body);
	if (!field) return body ? { kind: 'note', text: body, guess: null, done: null, line } : null;

	const kind = field[1].toLowerCase() as CaptureKind;
	const value = field[2].trim();
	if (kind === 'action') return { kind, text: value, guess: null, done: false, line };
	if (kind !== 'term') return { kind, text: value, guess: null, done: null, line };

	const split = GUESS.exec(value);
	if (!split) return { kind, text: value, guess: null, done: null, line };
	const guess = value.slice(split.index + split[0].length).trim();
	return { kind, text: value.slice(0, split.index).trim(), guess: guess || null, done: null, line };
}

/**
 * The line to append for a capture. Pure.
 *
 * Newlines inside the text become spaces, because a capture is one line and
 * a second one would fall outside the grammar. An empty guess is left out
 * rather than written as `guess::` with nothing after it.
 */
export function formatCaptured(input: CaptureInput): string {
	const text = oneLine(input.text);
	switch (input.kind) {
		case 'term': {
			const guess = oneLine(input.guess ?? '');
			return guess ? `- term:: ${text} guess:: ${guess}` : `- term:: ${text}`;
		}
		case 'question':
			return `- question:: ${text}`;
		case 'decision':
			return `- decision:: ${text}`;
		case 'action':
			return `- [ ] action:: ${text}`;
		case 'note':
			return `- ${text}`;
	}
}

/**
 * Every captured item in a note, in file order.
 *
 * Reads only the `## Captured` section, stops at the next heading, and never
 * looks inside a fenced block. A note with no such section has captured
 * nothing.
 */
export function scanCaptured(content: string): CapturedItem[] {
	const out: CapturedItem[] = [];
	for (const { raw, line } of sectionLines(content, CAPTURED_HEADING)) {
		const item = parseCaptured(raw, line);
		if (item) out.push(item);
	}
	return out;
}

/**
 * The talking points in a note: the text of each top-level bullet under
 * `## Talking points`, in file order. Empty when the note has none.
 */
export function scanTalkingPoints(content: string): string[] {
	const out: string[] = [];
	for (const { raw } of sectionLines(content, TALKING_POINTS_HEADING)) {
		const bullet = BULLET.exec(raw.replace(/\r$/, ''));
		if (bullet && bullet[2].trim()) out.push(bullet[2].trim());
	}
	return out;
}

/** The unfenced lines of every section headed exactly `heading`. */
function sectionLines(content: string, heading: string): Array<{ raw: string; line: number }> {
	const lines = content.split('\n');
	const out: Array<{ raw: string; line: number }> = [];
	const wanted = heading.toLowerCase();
	let fence: string | null = null;
	let inside = false;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;
		if (HEADING.test(raw)) {
			inside = raw.trim().toLowerCase() === wanted;
			continue;
		}
		if (inside) out.push({ raw, line: i });
	}
	return out;
}

/**
 * A task's words without the `action::` marker, for showing an open action
 * away from its note. Text with no marker comes back trimmed and otherwise
 * as it was.
 */
export function actionText(text: string): string {
	return text.replace(/^action::[ \t]*/i, '').trim();
}

/**
 * Read a meeting note. Pure; `path` supplies the date and a fallback title.
 *
 * The frontmatter is read with the shared note parser except for `ended`,
 * which is read from its raw line: YAML would turn `10:45` into the
 * sexagesimal number 645.
 */
export function readMeeting(content: string, path: string): MeetingMeta {
	const parsed = parseNote(content, path);
	const fm = parsed.frontmatter;
	const name = basename(path);
	const dated = DATED_NAME.exec(name);

	const h1 = parsed.headings.find((h) => h.level === 1)?.text;
	return {
		title: h1 ?? (dated ? dated[2] : name),
		type: fm.type === 'standup' ? 'standup' : 'meeting',
		date: dated ? dated[1] : dayOf(fm.date),
		event: typeof fm.event === 'string' && fm.event.trim() ? fm.event.trim() : null,
		attendees: Array.isArray(fm.attendees) ? fm.attendees.map(String).filter(Boolean) : [],
		ended: frontmatterValue(content, 'ended'),
		captured: scanCaptured(content)
	};
}

/** A YAML date (parsed to a UTC Date) or a string, as `YYYY-MM-DD`. */
function dayOf(value: unknown): string | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
	return null;
}

/** Where the frontmatter block sits, as line indices of its two fences. */
function frontmatterFences(lines: string[]): { open: number; close: number } | null {
	if (lines.length === 0 || lines[0].replace(/\r$/, '').trimEnd() !== '---') return null;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].replace(/\r$/, '').trimEnd() === '---') return { open: 0, close: i };
	}
	return null;
}

/** The raw value of a top-level frontmatter key, trimmed, or null. */
export function frontmatterValue(content: string, key: string): string | null {
	const lines = content.split('\n');
	const fences = frontmatterFences(lines);
	if (!fences) return null;
	const pattern = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*\\r?$`);
	for (let i = fences.open + 1; i < fences.close; i++) {
		const m = pattern.exec(lines[i]);
		if (m) return m[1] === '' ? null : m[1].replace(/^["']|["']$/g, '');
	}
	return null;
}

/**
 * Mark a meeting ended at `time` (`HH:MM`). Pure.
 *
 * Rewrites the value of an existing top-level `ended:` line, or inserts one
 * just above the closing `---`, or, in a note with no frontmatter at all,
 * inserts a three-line block at the top. Every other byte of the note is
 * kept, line endings included.
 */
export function setEnded(content: string, time: string): string {
	const lines = content.split('\n');
	const fences = frontmatterFences(lines);
	if (!fences) return `---\nended: ${time}\n---\n${content}`;

	for (let i = fences.open + 1; i < fences.close; i++) {
		const m = /^(ended:[ \t]*)(.*?)(\r?)$/.exec(lines[i]);
		if (m) {
			lines[i] = `${m[1] === 'ended:' ? 'ended: ' : m[1]}${time}${m[3]}`;
			return lines.join('\n');
		}
	}
	const cr = lines[fences.close].endsWith('\r') ? '\r' : '';
	lines.splice(fences.close, 0, `ended: ${time}${cr}`);
	return lines.join('\n');
}

/** What a new meeting note starts with. */
interface NewMeeting {
	type: MeetingType;
	date: string;
	title: string;
	event?: string | null;
	attendees?: string[];
	/** Drafted points to start the note with, above Captured. */
	talkingPoints?: string[];
}

/**
 * The text of a new meeting note. Pure.
 *
 * `event` and `attendees` are left out when there are none, as every other
 * optional marker this app writes is. Values YAML would misread are quoted.
 */
export function newMeetingNote(input: NewMeeting): string {
	const fm = [`type: ${input.type}`, `date: ${input.date}`];
	if (input.event) fm.push(`event: ${yamlScalar(input.event)}`);
	const attendees = (input.attendees ?? []).map(oneLine).filter(Boolean);
	if (attendees.length) fm.push(`attendees: [${attendees.map(yamlFlowItem).join(', ')}]`);

	const points = (input.talkingPoints ?? []).map(oneLine).filter(Boolean);
	const prep = points.length ? `${TALKING_POINTS_HEADING}\n${points.map((p) => `- ${p}`).join('\n')}\n\n` : '';
	return `---\n${fm.join('\n')}\n---\n# ${oneLine(input.title) || 'Meeting'}\n\n${prep}${CAPTURED_HEADING}\n`;
}

/**
 * Where a meeting note for `title` on `date` goes, avoiding the paths in
 * `taken` by adding " 2", " 3" and so on. Pure.
 *
 * Characters a file name cannot hold, or that Obsidian treats as link syntax,
 * are dropped from the title; an empty result is "Meeting".
 */
export function meetingPath(folder: string, date: string, title: string, taken: Iterable<string> = []): string {
	const safe = oneLine(title).replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim() || 'Meeting';
	const used = new Set(taken);
	for (let n = 1; ; n++) {
		const path = `${folder}/${date} ${safe}${n === 1 ? '' : ` ${n}`}.md`;
		if (!used.has(path)) return path;
	}
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** A YAML plain scalar when that is safe, a JSON-quoted string otherwise. */
function yamlScalar(value: string): string {
	const v = oneLine(value);
	return /^[A-Za-z0-9_][\w.@/+=-]*$/.test(v) ? v : JSON.stringify(v);
}

/** The same, for an item in a `[a, b]` flow sequence, where spaces are fine. */
function yamlFlowItem(value: string): string {
	return /^[A-Za-z0-9_][\w .@'-]*$/.test(value) && !value.endsWith(' ') ? value : JSON.stringify(value);
}

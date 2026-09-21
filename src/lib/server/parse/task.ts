/**
 * Parsing and surgical rewriting of the vault's task lines.
 *
 * The real shape in this vault is:
 *
 *     - [x] 09:30 - 10:00 Morning stretch `Q1`
 *
 * a checkbox, an optional Day Planner time range, the text, and an optional
 * Eisenhower quadrant written as inline code. Tasks-plugin emoji fields may
 * also appear; they are preserved but only ever written by a hub feature that
 * needs one.
 *
 * Two rules hold throughout this module:
 *
 *  - Every rewrite edits the original line through character spans, so trailing
 *    whitespace, emoji fields and anything else this parser does not model
 *    survive untouched.
 *  - Nothing here reorders, inserts or deletes lines.
 */

import type { Task, TaskStatus } from '$lib/shared/task';
import { scanTags } from './note';

export type { TaskStatus };

/** Half-open character range into the raw line. */
export interface Span {
	start: number;
	end: number;
}

export interface TaskLine {
	/** 0-based index of this line within the file. */
	line: number;
	/** Last line of the block this task owns, including indented sub-bullets. */
	blockEnd: number;
	/** Leading whitespace, preserved on rewrite. */
	indent: string;
	status: TaskStatus;
	/** Character inside the brackets, e.g. ' ', 'x', '/'. */
	statusChar: string;
	/** 'HH:MM' start of the Day Planner range, or null when unscheduled. */
	start: string | null;
	/** 'HH:MM' end of the range, or null. */
	end: string | null;
	/** Text with the time range and quadrant removed, trimmed. */
	text: string;
	/** 1..4, or null when the task carries no quadrant. */
	quadrant: number | null;
	/** True when the line sits inside a fenced code block, as the Backlog does. */
	fenced: boolean;
	/** The line exactly as it appears in the file. */
	raw: string;
	/** Tags on the line without their `#`, e.g. `ws/work`, in written order. */
	tags: string[];
	/** Value of the Tasks-plugin `\u{1F194}` field, which names this task so others can block on it. */
	id: string | null;
	/** Ids from `\u{26D4}`, one entry per comma-separated value. */
	blockedBy: string[];
	/** Date from `\u{1F4C5}` exactly as written, usually `YYYY-MM-DD`. */
	due: string | null;
	spans: {
		status: Span;
		/** Covers only 'HH:MM - HH:MM', never the space that follows it. */
		time: Span | null;
		/** Covers the backticks as well as the token. */
		quadrant: Span | null;
		/** Where the text begins, used to insert a time range. */
		bodyStart: number;
		/**
		 * The words of the task, between the time range and the trailing run of
		 * quadrant, tags and emoji fields. Replacing this span renames the task
		 * without disturbing anything else on the line.
		 */
		text: Span;
		tags: TaskTag[];
		fields: TaskField[];
	};
}

/** A Tasks-plugin emoji field and the range it occupies, marker included. */
export interface TaskField extends Span {
	marker: string;
	/** Text after the marker: a date, an id, a recurrence rule, or '' for a priority. */
	value: string;
}

/** A tag and the range it occupies, `#` included. */
export interface TaskTag extends Span {
	tag: string;
}

const STATUS_BY_CHAR: Record<string, TaskStatus> = {
	' ': 'todo',
	x: 'done',
	X: 'done',
	'/': 'in-progress',
	'-': 'cancelled',
	'!': 'blocked'
};

const CHAR_BY_STATUS: Record<TaskStatus, string> = {
	todo: ' ',
	done: 'x',
	'in-progress': '/',
	cancelled: '-',
	blocked: '!'
};

const BULLET = /^([ \t]*)([-*+])([ \t]+)\[(.)\]([ \t]+)/;
const TIME_RANGE = /^(\d{1,2}:\d{2})[ \t]*-[ \t]*(\d{1,2}:\d{2})(?=[ \t]|$)/;
const QUADRANT = /`Q([1-4])`/g;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Tasks-plugin emoji fields, in the order the plugin writes them. The hub only
 * gives meaning to due, id and blocked-by; the rest are modelled so that the
 * trailing run of fields can be told apart from the words of the task, and so
 * they survive every rewrite.
 */
export const FIELD = {
	due: '\u{1F4C5}',
	scheduled: '\u{23F3}',
	start: '\u{1F6EB}',
	done: '\u2705',
	cancelled: '\u274C',
	created: '\u2795',
	id: '\u{1F194}',
	blockedBy: '\u26D4',
	recurrence: '\u{1F501}'
} as const;

const PRIORITIES = ['\u{1F53A}', '\u23EB', '\u{1F53C}', '\u{1F53D}', '\u23EC'];
const MARKERS = [...Object.values(FIELD), ...PRIORITIES];
const MARKER_RE = new RegExp(`(${MARKERS.join('|')})`, 'gu');
const VALUELESS = new Set(PRIORITIES);
const TOKEN_VALUE = /^[ \t]*(\S+)/;

/**
 * Parse one line. Returns null when the line is not a task, which includes
 * plain bullets, headings and prose. An unrecognised status character is
 * reported as 'todo' rather than rejected, so an unfamiliar marker never
 * makes a line disappear from the hub.
 */
export function parseTaskLine(raw: string, line = 0, fenced = false): TaskLine | null {
	const m = BULLET.exec(raw);
	if (!m) return null;

	const [matched, indent, , afterBullet, statusChar] = m;
	const statusStart = indent.length + 1 + afterBullet.length + 1;
	const bodyStart = matched.length;
	const body = raw.slice(bodyStart);

	let start: string | null = null;
	let end: string | null = null;
	let time: Span | null = null;
	const t = TIME_RANGE.exec(body);
	if (t) {
		start = normaliseTime(t[1]);
		end = normaliseTime(t[2]);
		time = { start: bodyStart, end: bodyStart + t[0].length };
	}

	let quadrant: number | null = null;
	let quadrantSpan: Span | null = null;
	QUADRANT.lastIndex = 0;
	for (let q = QUADRANT.exec(body); q; q = QUADRANT.exec(body)) {
		quadrant = Number(q[1]);
		quadrantSpan = { start: bodyStart + q.index, end: bodyStart + q.index + q[0].length };
	}

	const fields = scanFields(body).map((f) => shift(f, bodyStart));
	const tags = scanTags(body).map((g) => shift(g, bodyStart));

	// Where the words stop and the trailing run of quadrant, tags and fields
	// begins. Anything this parser does not recognise counts as part of the
	// words, so an unmodelled token is never mistaken for metadata.
	const contentEnd = bodyStart + endOfContent(body);
	const trailer = trailerStart(raw, [...fields, ...tags, ...(quadrantSpan ? [quadrantSpan] : [])], contentEnd);
	const textStart = time ? bodyStart + skipSpace(body, time.end - bodyStart) : bodyStart;
	const textEnd = Math.max(textStart, trimEnd(raw, textStart, trailer));

	const field = (marker: string) => fields.find((f) => f.marker === marker)?.value ?? null;
	const blocked = field(FIELD.blockedBy);

	return {
		line,
		blockEnd: line,
		indent,
		status: STATUS_BY_CHAR[statusChar] ?? 'todo',
		statusChar,
		start,
		end,
		text: raw.slice(textStart, textEnd),
		quadrant,
		fenced,
		raw,
		tags: tags.map((g) => g.tag),
		id: field(FIELD.id),
		blockedBy: blocked ? blocked.split(',').map((v) => v.trim()).filter(Boolean) : [],
		due: field(FIELD.due),
		spans: {
			status: { start: statusStart, end: statusStart + 1 },
			time,
			quadrant: quadrantSpan,
			bodyStart,
			text: { start: textStart, end: textEnd },
			tags,
			fields
		}
	};
}

/**
 * Every emoji field in the body, with the range each occupies including its
 * marker. A date or id takes the next whitespace-delimited token; a priority
 * takes nothing; a recurrence takes everything up to the next marker, because
 * "every other week" cannot be recognised token by token.
 */
function scanFields(body: string): TaskField[] {
	const hits = [...body.matchAll(MARKER_RE)].map((m) => ({ marker: m[1], at: m.index ?? 0, after: (m.index ?? 0) + m[1].length }));
	const contentEnd = endOfContent(body);
	const found: TaskField[] = [];

	for (let k = 0; k < hits.length; k++) {
		const hit = hits[k];
		const limit = Math.max(hit.after, k + 1 < hits.length ? hits[k + 1].at : contentEnd);
		if (VALUELESS.has(hit.marker)) {
			found.push({ marker: hit.marker, value: '', start: hit.at, end: hit.after });
			continue;
		}
		const region = body.slice(hit.after, limit);
		if (hit.marker === FIELD.recurrence) {
			const value = region.trim();
			found.push({ marker: hit.marker, value, start: hit.at, end: value ? hit.after + trimEnd(region, 0, region.length) : hit.after });
			continue;
		}
		const token = TOKEN_VALUE.exec(region);
		if (!token) found.push({ marker: hit.marker, value: '', start: hit.at, end: hit.after });
		else found.push({ marker: hit.marker, value: token[1], start: hit.at, end: hit.after + token[0].length });
	}
	return found;
}

/**
 * Walk back from the end of the line over whitespace and recognised tokens.
 * Stops at the first thing it does not recognise, which is the last word of
 * the task.
 */
function trailerStart(raw: string, tokens: Span[], contentEnd: number): number {
	let cursor = contentEnd;
	for (;;) {
		let at = cursor;
		while (at > 0 && (raw[at - 1] === ' ' || raw[at - 1] === '\t')) at--;
		const token = tokens.find((tk) => tk.end === at && tk.start < at);
		if (!token) return cursor;
		cursor = token.start;
	}
}

function shift<T extends Span>(span: T, by: number): T {
	return { ...span, start: span.start + by, end: span.end + by };
}

/**
 * Find every task in a note. Tasks inside fenced code blocks are returned with
 * `fenced: true` rather than dropped, because this vault keeps its Backlog
 * inside a fence and the hub still shows it.
 *
 * `blockEnd` extends over the indented sub-bullets that belong to a task, so a
 * caller moving a task knows what travels with it.
 */
export function scanTasks(content: string): TaskLine[] {
	const lines = content.split('\n');
	const tasks: TaskLine[] = [];
	let fence: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		const task = parseTaskLine(lines[i], i, fence !== null);
		if (task) tasks.push(task);
	}

	for (const task of tasks) {
		let last = task.line;
		for (let i = task.line + 1; i < lines.length; i++) {
			const line = lines[i];
			if (line.trim() === '') break;
			const indent = /^[ \t]*/.exec(line)![0];
			if (indent.length <= task.indent.length) break;
			if (parseTaskLine(line)) break;
			last = i;
		}
		task.blockEnd = last;
	}

	return tasks;
}

export interface TaskEdit {
	status?: TaskStatus;
	/** null clears the range; an object sets or replaces it. */
	time?: { start: string; end: string } | null;
	/** null clears the quadrant; 1..4 sets it. */
	quadrant?: number | null;
	/** New words for the task. An empty string is ignored rather than emptying the line. */
	text?: string;
	/** Due date as `YYYY-MM-DD`, or null to remove it. */
	due?: string | null;
	/** The task's own id, or null to remove it. */
	id?: string | null;
	/** Ids this task waits on. An empty list or null removes the field. */
	blockedBy?: string[] | null;
	/** Tags to add, without `#`. Already-present tags are left where they are. */
	addTags?: string[];
	/** Tags to remove, without `#`. Absent tags are ignored. */
	removeTags?: string[];
}

/**
 * Apply an edit to one task line and return the new line. Fields absent from
 * `edit` are left alone. Returns the line unchanged when it is not a task, so
 * a caller working from a stale line number cannot corrupt prose.
 *
 * Every change is expressed as a character range, so trailing whitespace and
 * anything this parser does not model survive exactly. New tags and fields are
 * appended after the existing ones; a new quadrant goes immediately after the
 * words, which is where this vault writes it.
 */
export function rewriteTaskLine(raw: string, edit: TaskEdit): string {
	const task = parseTaskLine(raw);
	if (!task) return raw;

	const patches: Array<{ span: Span; text: string }> = [];
	const appended: string[] = [];

	if (edit.status !== undefined) {
		patches.push({ span: task.spans.status, text: CHAR_BY_STATUS[edit.status] });
	}

	if (edit.time !== undefined) {
		if (edit.time === null) {
			if (task.spans.time) {
				patches.push({ span: { start: task.spans.time.start, end: skipSpace(raw, task.spans.time.end) }, text: '' });
			}
		} else {
			const range = `${normaliseTime(edit.time.start)} - ${normaliseTime(edit.time.end)}`;
			if (task.spans.time) patches.push({ span: task.spans.time, text: range });
			else patches.push({ span: { start: task.spans.bodyStart, end: task.spans.bodyStart }, text: `${range} ` });
		}
	}

	if (edit.text) {
		const words = edit.text.replace(/\s+/g, ' ').trim();
		const span = task.spans.text;
		const joins = span.start === span.end && raw[span.end] !== undefined && raw[span.end] !== ' ' && raw[span.end] !== '\t';
		if (words) patches.push({ span, text: joins ? `${words} ` : words });
	}

	if (edit.quadrant !== undefined) {
		if (edit.quadrant === null) {
			if (task.spans.quadrant) {
				patches.push({ span: { start: backOverOneSpace(raw, task.spans.quadrant.start), end: task.spans.quadrant.end }, text: '' });
			}
		} else {
			const token = `\`Q${edit.quadrant}\``;
			if (task.spans.quadrant) patches.push({ span: task.spans.quadrant, text: token });
			else patches.push({ span: { start: task.spans.text.end, end: task.spans.text.end }, text: ` ${token}` });
		}
	}

	if (edit.due !== undefined) field(raw, task, FIELD.due, edit.due, patches, appended);
	if (edit.id !== undefined) field(raw, task, FIELD.id, edit.id, patches, appended);
	if (edit.blockedBy !== undefined) {
		const ids = edit.blockedBy?.filter(Boolean) ?? [];
		field(raw, task, FIELD.blockedBy, ids.length ? ids.join(',') : null, patches, appended);
	}

	for (const tag of edit.removeTags ?? []) {
		for (const found of task.spans.tags.filter((g) => g.tag === tag)) {
			patches.push({ span: { start: backOverOneSpace(raw, found.start), end: found.end }, text: '' });
		}
	}
	for (const tag of edit.addTags ?? []) {
		if (!task.tags.includes(tag)) appended.push(`#${tag}`);
	}

	if (appended.length) {
		const at = endOfContent(raw);
		patches.push({ span: { start: at, end: at }, text: appended.map((piece) => ` ${piece}`).join('') });
	}

	let out = raw;
	for (const p of patches.sort((a, b) => b.span.start - a.span.start)) {
		out = out.slice(0, p.span.start) + p.text + out.slice(p.span.end);
	}
	return out;
}

/**
 * Set, replace or remove one emoji field. Removing takes the space in front of
 * the marker with it, so clearing a field never leaves a double space behind.
 */
function field(
	raw: string,
	task: TaskLine,
	marker: string,
	value: string | null,
	patches: Array<{ span: Span; text: string }>,
	appended: string[]
): void {
	const existing = task.spans.fields.find((f) => f.marker === marker);
	if (value === null) {
		if (existing) patches.push({ span: { start: backOverOneSpace(raw, existing.start), end: existing.end }, text: '' });
	} else if (existing) {
		patches.push({ span: existing, text: `${marker} ${value}` });
	} else {
		appended.push(`${marker} ${value}`);
	}
}

/** Minutes since midnight, or null when the task is unscheduled. */
export function startMinutes(task: TaskLine): number | null {
	return task.start ? toMinutes(task.start) : null;
}

/** Duration in minutes, or null when the task has no range. */
export function durationMinutes(task: TaskLine): number | null {
	if (!task.start || !task.end) return null;
	const d = toMinutes(task.end) - toMinutes(task.start);
	return d < 0 ? d + 24 * 60 : d;
}

function toMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':');
	return Number(h) * 60 + Number(m);
}

function normaliseTime(hhmm: string): string {
	const [h, m] = hhmm.split(':');
	return `${h.padStart(2, '0')}:${m}`;
}

function skipSpace(raw: string, from: number): number {
	let i = from;
	while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++;
	return i;
}

function backOverOneSpace(raw: string, from: number): number {
	return from > 0 && (raw[from - 1] === ' ' || raw[from - 1] === '\t') ? from - 1 : from;
}

/** Index after the last non-space character in [from, to). */
function trimEnd(raw: string, from: number, to: number): number {
	let i = to;
	while (i > from && (raw[i - 1] === ' ' || raw[i - 1] === '\t' || raw[i - 1] === '\r')) i--;
	return i;
}

function endOfContent(raw: string): number {
	let i = raw.length;
	while (i > 0 && (raw[i - 1] === ' ' || raw[i - 1] === '\t' || raw[i - 1] === '\r')) i--;
	return i;
}

/**
 * Convert a parsed line into the shape the rest of the app and the browser
 * share. Times become minutes since midnight here, once, rather than in each
 * caller.
 */
export function toTask(line: TaskLine, path: string): Task {
	return {
		path,
		line: line.line,
		blockEnd: line.blockEnd,
		status: line.status,
		startMin: line.start ? toMinutes(line.start) : null,
		endMin: line.end ? toMinutes(line.end) : null,
		text: line.text,
		quadrant: line.quadrant,
		fenced: line.fenced,
		raw: line.raw,
		tags: line.tags,
		id: line.id,
		blockedBy: line.blockedBy,
		due: line.due
	};
}

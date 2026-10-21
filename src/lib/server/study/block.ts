/**
 * Finding a subject's block in a day's note, and writing what came of it.
 *
 * The author time-blocks the day in Obsidian with lines such as
 * `- [ ] 17:00 - 17:30 Study Fullstack `Q2``. A line belongs to a subject when
 * its words contain the subject's name or one of its aliases. This module is
 * the only place that reads that convention, and the only place that knows the
 * shape of the sub-bullet a finished session leaves under its block:
 *
 *     - [x] 17:00 - 17:30 Study Fullstack `Q2`
 *     	- Fullstack: Finish react.dev Describing the UI, 25m, progress · scratch words
 *
 * Everything here is pure: text in, text or numbers out. Reading and writing
 * the note is `session.ts`'s business.
 */

import { scanTasks, type TaskLine } from '../parse/task';
import { OPEN_STATUSES } from '$lib/shared/task';
import type { Outcome } from '$lib/shared/study';

/** A session's default length when its block gives no times. */
export const DEFAULT_MINUTES = 30;

const OUTCOMES: Outcome[] = ['done', 'progress', 'skipped'];

const toMinutes = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
};

/** A block found in a day's note. */
export interface Block {
	/** 0-based line of the task. */
	line: number;
	/** Last line of the task and its sub-bullets. */
	blockEnd: number;
	/** The line exactly as it is in the note. */
	raw: string;
	/** Minutes since midnight, or null when the line carries no times. */
	startMin: number | null;
	endMin: number | null;
}

/** True when `text` mentions `name` as a whole word or phrase, ignoring case. Pure. */
function mentions(text: string, name: string): boolean {
	const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return escaped.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * The first open task in `content`, in file order, whose words mention one of
 * `names` (a subject's name and aliases). Null when there is none.
 *
 * Skips ticked and cancelled tasks, and anything inside a code fence, so the
 * Backlog never matches. A name must stand alone as a word: "Rust" does not
 * match "Trust". Pure.
 */
export function blockFor(content: string, names: string[]): Block | null {
	const found = scanTasks(content).find(
		(t) => !t.fenced && OPEN_STATUSES.includes(t.status) && names.some((name) => mentions(t.text, name))
	);
	return found ? toBlock(found) : null;
}

function toBlock(t: TaskLine): Block {
	return { line: t.line, blockEnd: t.blockEnd, raw: t.raw, startMin: t.start ? toMinutes(t.start) : null, endMin: t.end ? toMinutes(t.end) : null };
}

/** The block's length in minutes: its range, or `DEFAULT_MINUTES` when it has none. Pure. */
export function blockMinutes(block: Block | null): number {
	if (!block || block.startMin === null || block.endMin === null || block.endMin <= block.startMin) return DEFAULT_MINUTES;
	return block.endMin - block.startMin;
}

/**
 * The sub-bullet a finished session leaves, without its indent: the subject,
 * the step, the minutes spent and how it went, then the scratch words when
 * there are any. Pure; newlines in the words become spaces so it stays one line.
 */
export function outcomeLine(subject: string, step: string, minutes: number, outcome: Outcome, note: string): string {
	const words = note.replace(/\s+/g, ' ').trim();
	return `- ${subject}: ${step.replace(/\s+/g, ' ').trim()}, ${minutes}m, ${outcome}${words ? ` · ${words}` : ''}`;
}

/**
 * Insert `bullet` as the last sub-bullet of the task at `line`, indented one
 * tab deeper than the task. Every other byte of the note is kept, and nothing
 * is reordered. Pure.
 */
export function withBullet(content: string, block: Pick<Block, 'blockEnd' | 'raw'>, bullet: string): string {
	const lines = content.split('\n');
	const indent = /^[ \t]*/.exec(block.raw)![0];
	lines.splice(block.blockEnd + 1, 0, `${indent}\t${bullet}`);
	return lines.join('\n');
}

/** One finished session read back out of a note. */
export interface LoggedSession {
	subject: string;
	minutes: number;
	outcome: Outcome;
}

const LOGGED = /^[ \t]*- (.+?): .*, (\d+)m, (done|progress|skipped)(?: · .*)?$/;

/** Every session the note records, in file order. Lines that are not one are ignored. Pure. */
export function loggedSessions(content: string): LoggedSession[] {
	const out: LoggedSession[] = [];
	for (const line of content.split('\n')) {
		const m = LOGGED.exec(line);
		if (m && OUTCOMES.includes(m[3] as Outcome)) out.push({ subject: m[1], minutes: Number(m[2]), outcome: m[3] as Outcome });
	}
	return out;
}

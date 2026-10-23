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
 * Every open task in `content`, in file order, whose words mention one of
 * `names` (a subject's name and aliases).
 *
 * Skips ticked and cancelled tasks, and anything inside a code fence, so the
 * Backlog never matches. A name must stand alone as a word: "Rust" does not
 * match "Trust". Pure.
 */
export function blocksFor(content: string, names: string[]): Block[] {
	return scanTasks(content)
		.filter((t) => !t.fenced && OPEN_STATUSES.includes(t.status) && names.some((name) => mentions(t.text, name)))
		.map(toBlock);
}

/** The first of `blocksFor`, or null. Pure. */
export function blockFor(content: string, names: string[]): Block | null {
	return blocksFor(content, names)[0] ?? null;
}

/**
 * The block to study next: the one a person would reach for now. Of every
 * open block for any of `subjects`, the timed one still running or yet to
 * come that starts soonest; failing that, one with no times, in file order;
 * failing that, the latest that has already ended. Null when no subject has a
 * block today. `nowMin` is minutes since midnight. Pure.
 */
export function nextBlock<S extends { names: string[] }>(content: string, subjects: S[], nowMin: number): { subject: S; block: Block } | null {
	const all = subjects.flatMap((subject) => blocksFor(content, subject.names).map((block) => ({ subject, block })));
	const timed = all.filter((b) => b.block.startMin !== null && b.block.endMin !== null);
	const ahead = timed.filter((b) => b.block.endMin! > nowMin).sort((a, b) => a.block.startMin! - b.block.startMin!);
	if (ahead.length) return ahead[0];
	const untimed = all.filter((b) => b.block.startMin === null || b.block.endMin === null);
	if (untimed.length) return untimed[0];
	return timed.sort((a, b) => b.block.endMin! - a.block.endMin!)[0] ?? null;
}

/** A scanned task as a `Block`: times become minutes since midnight (`24:00` is 1440). Pure. */
export function toBlock(t: TaskLine): Block {
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

/**
 * True when a logged-session sub-bullet (the `loggedSessions` format, any
 * outcome) sits under `block`, between its line + 1 and its `blockEnd`. A
 * block with one has been worked on or deliberately skipped. Lines outside
 * that range are never looked at. Pure.
 */
export function hasLoggedSession(content: string, block: Pick<Block, 'line' | 'blockEnd'>): boolean {
	const lines = content.split('\n');
	for (let i = block.line + 1; i <= block.blockEnd && i < lines.length; i++) if (LOGGED.test(lines[i])) return true;
	return false;
}

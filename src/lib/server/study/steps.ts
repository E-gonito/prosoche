/**
 * What makes a study step easy to start: how long it should take, the very
 * first thing to do, and the short parts it breaks into. And moving a
 * goal's late steps back onto the calendar.
 *
 * The details are sub-bullets of the step's own task line in `Goals.md`,
 * Dataview-style, so they read in Obsidian and survive any task edit:
 *
 *     ## Rust via leyline-front
 *     target:: 2026-12-13
 *     repo:: ~/dev/leyline-front
 *     - [ ] Exercise 1: implement PCG32 … 📅 2026-10-25
 *     	- est:: 2h
 *     	- first:: Run `cargo test rng` and read the first failing test
 *     	- part:: Read Rust book chapter 3
 *     	- part:: Translate `pcg32_random_r`
 *
 * `est::` is free text (`45m`, `1.5–2h`), shown as written. `repo::`, under
 * a goal's heading, is where its work happens, for the tutor prompt. Every
 * other sub-bullet is the user's and is never touched. Pure throughout.
 */

import { parseTaskLine, rewriteTaskLine } from '../parse/task';
import { addDays, daysBetween } from '$lib/shared/time';
import type { StepDetails } from '$lib/shared/study';

export type { StepDetails };


const DETAIL = /^([ \t]+)[-*+][ \t]+(est|first|part)::[ \t]*(.*?)[ \t]*$/;
const CHILD = /^[ \t]+\S/;
const REPO = /^repo::[ \t]*(\S.*?)[ \t]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The lines indented under the line at `line`: its block of sub-bullets, as indexes. */
function childLines(lines: string[], line: number): number[] {
	const out: number[] = [];
	for (let i = line + 1; i < lines.length && CHILD.test(lines[i]); i++) out.push(i);
	return out;
}

/** The details under the task at `line` of `content`. Pure. */
export function stepDetails(content: string, line: number): StepDetails {
	const lines = content.split('\n');
	const out: StepDetails = { est: null, first: null, parts: [] };
	for (const i of childLines(lines, line)) {
		const m = DETAIL.exec(lines[i]);
		if (!m || !m[3]) continue;
		if (m[2] === 'part') out.parts.push(m[3]);
		else if (out[m[2] as 'est' | 'first'] === null) out[m[2] as 'est' | 'first'] = m[3];
	}
	return out;
}

/** The `repo::` line under a goal heading at `heading`, before its next heading. Pure. */
export function goalRepo(content: string, heading: number): string | null {
	const lines = content.split('\n');
	for (let i = heading + 1; i < lines.length && !/^#{1,6}[ \t]/.test(lines[i]); i++) {
		const m = REPO.exec(lines[i]);
		if (m) return m[1];
	}
	return null;
}

/**
 * `content` with the task at `line`'s details set to `details`: its old
 * `est::`, `first::` and `part::` sub-bullets removed and the new ones put
 * first under it, indented as its other sub-bullets are (a tab when it has
 * none). Its other sub-bullets keep their order and bytes. Null when the
 * line is not a task. Pure.
 */
export function withStepDetails(content: string, line: number, details: StepDetails): string | null {
	const lines = content.split('\n');
	if (!parseTaskLine(lines[line] ?? '', line)) return null;
	const children = childLines(lines, line);
	const indent = children.length ? /^[ \t]+/.exec(lines[children[0]])![0] : '\t';
	const kept = children.filter((i) => !DETAIL.test(lines[i])).map((i) => lines[i]);
	const fresh = [
		...(details.est ? [`${indent}- est:: ${oneLine(details.est)}`] : []),
		...(details.first ? [`${indent}- first:: ${oneLine(details.first)}`] : []),
		...details.parts.filter((p) => p.trim()).map((p) => `${indent}- part:: ${oneLine(p)}`)
	];
	lines.splice(line + 1, children.length, ...fresh, ...kept);
	return lines.join('\n');
}

/** What replanning a goal would do: how far its open steps move, and how many. */
export interface Replan {
	/** Days every open dated step moves later. */
	shift: number;
	steps: number;
	content: string;
}

/**
 * Move a goal's late steps back onto the calendar: every open, dated step
 * of the goal headed at `heading` moves later by the same number of days,
 * so the earliest late one is due `today` and the gaps between them stay as
 * planned. Done and skipped steps keep their dates. The goal's `target::`
 * moves only if a step would now fall after it, and then to that step's
 * day. Only 📅 dates and that one line change, through the task rewrite.
 * Null when nothing in the goal is late. Pure.
 */
export function replanGoal(content: string, heading: number, today: string): Replan | null {
	const lines = content.split('\n');
	let end = lines.length;
	for (let i = heading + 1; i < lines.length; i++) if (/^#{1,6}[ \t]/.test(lines[i])) { end = i; break; }

	const open: Array<{ line: number; due: string }> = [];
	for (let i = heading + 1; i < end; i++) {
		const task = parseTaskLine(lines[i], i);
		if (task && !task.fenced && ['todo', 'in-progress', 'blocked'].includes(task.status) && task.due && DAY.test(task.due)) open.push({ line: i, due: task.due });
	}
	const late = open.filter((t) => t.due < today).map((t) => t.due).sort()[0];
	if (!late) return null;
	const shift = daysBetween(late, today);
	let last = '';
	for (const t of open) {
		const due = addDays(t.due, shift);
		lines[t.line] = rewriteTaskLine(lines[t.line], { due });
		if (due > last) last = due;
	}
	for (let i = heading + 1; i < end; i++) {
		const m = /^(target::[ \t]*)(\d{4}-\d{2}-\d{2})([ \t]*)$/.exec(lines[i]);
		if (m && m[2] < last) lines[i] = `${m[1]}${last}${m[3]}`;
		if (m) break;
	}
	return { shift, steps: open.length, content: lines.join('\n') };
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

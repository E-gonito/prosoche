/**
 * Goals: what the user is working towards, and the milestones on the way.
 *
 * One note, `<study home>/Goals.md`, holds every goal:
 *
 *     ---
 *     weekly_hours: 6
 *     ---
 *     ## Pass AWS Solutions Architect
 *     target:: 2026-12-15
 *     - [x] Finish the networking module 📅 2026-10-05
 *     - [ ] Two practice exams 📅 2026-11-20
 *
 * A `## ` heading names a goal; an optional `target::` line beneath it is the
 * day the whole goal is due; every task line under it, up to the next heading
 * of any level, is a milestone. `weekly_hours:` in the note's frontmatter is
 * this section's only other field, read by Overview for the week's target.
 *
 * A milestone is not a shape of its own: it is a `Task`, identified by `path`
 * and `line` exactly as `/api/task` expects, so ticking one is the ordinary
 * task rewrite everything else in the hub uses, never a parser of its own.
 * This module only ever appends — a new goal's heading, or a new milestone's
 * line — and never rewrites one, so a page reload always shows exactly the
 * bytes on disk.
 */

import { parseNote } from '../parse/note';
import { FIELD, parseTaskLine, toTask } from '../parse/task';
import { appendUnderHeading } from '../sections';
import type { Task } from '$lib/shared/task';
import type { Vault } from '../vault/index';

export interface Goal {
	/** The `## ` heading's text, verbatim. */
	title: string;
	/** 0-based line of the heading. */
	line: number;
	/** `target::`'s date, exactly as written, or null when the goal names none. */
	target: string | null;
	/** In file order, same as everywhere else the hub reads a task list. */
	milestones: Task[];
}

export interface GoalsNote {
	/** `weekly_hours:` from the frontmatter, or null when it names none. */
	weeklyHours: number | null;
	goals: Goal[];
}

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const TARGET = /^target::[ \t]*(\S.*?)[ \t]*$/;

/**
 * Every goal in a `Goals.md` note, milestones included, in file order.
 *
 * Pure: `content` and `path` in, structure out, `path` only stamped onto the
 * milestones so they can be ticked. A goal's section runs from its `## `
 * heading to the next heading of any level — the same rule
 * `appendUnderHeading` uses to find where a section ends — so parsing and
 * appending never disagree about which lines belong to which goal.
 */
export function parseGoals(content: string, path = ''): GoalsNote {
	const { frontmatter } = parseNote(content, path);
	const weeklyHours = typeof frontmatter.weekly_hours === 'number' ? frontmatter.weekly_hours : null;

	const lines = content.split('\n');
	const headings: Array<{ level: number; title: string; line: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		const m = HEADING.exec(lines[i]);
		if (m) headings.push({ level: m[1].length, title: m[2], line: i });
	}

	const goals: Goal[] = headings
		.filter((h) => h.level === 2)
		.map((h) => {
			const end = headings.find((o) => o.line > h.line)?.line ?? lines.length;
			let target: string | null = null;
			const milestones: Task[] = [];
			for (let l = h.line + 1; l < end; l++) {
				if (target === null) {
					const t = TARGET.exec(lines[l]);
					if (t) {
						target = t[1];
						continue;
					}
				}
				const task = parseTaskLine(lines[l], l);
				if (task && !task.fenced) milestones.push(toTask(task, path));
			}
			return { title: h.title, line: h.line, target, milestones };
		});

	return { weeklyHours, goals };
}

/**
 * `content` with a new `## <title>` goal appended, `target::` too when given.
 * Pure. Appends after trimming trailing blank lines, so a note that already
 * ends tidily stays tidy.
 */
export function withNewGoal(content: string, title: string, target: string | null): string {
	const body = content.replace(/\s+$/, '');
	const prefix = body ? `${body}\n\n` : '';
	const heading = [`## ${title}`, ...(target ? [`target:: ${target}`] : [])];
	return `${prefix}${heading.join('\n')}\n`;
}

/**
 * `content` with one milestone task appended under `## <heading>`, written
 * with the same `📅` due-date field every other task in the vault uses. Pure,
 * and it returns the line it inserted, so a caller can locate the new
 * milestone without rereading the note.
 */
export function withNewMilestone(
	content: string,
	heading: string,
	text: string,
	due: string | null
): { content: string; line: number } {
	const words = text.trim();
	const raw = due ? `- [ ] ${words} ${FIELD.due} ${due}` : `- [ ] ${words}`;
	return appendUnderHeading(content, `## ${heading}`, raw);
}

export type GoalWrite = { ok: true } | { ok: false; reason: 'conflict' };

/** Append a goal to `path`, creating the note when this is its first. */
export async function addGoal(vault: Vault, path: string, title: string, target: string | null): Promise<GoalWrite> {
	const note = await vault.read(path);
	const content = withNewGoal(note.content, title, target);
	const written = await vault.write(path, content, note.exists ? note.hash : undefined);
	return written.ok ? { ok: true } : { ok: false, reason: 'conflict' };
}

export type MilestoneWrite = { ok: true; task: Task } | { ok: false; reason: 'conflict' | 'no-note' };

/**
 * Append a milestone under an existing goal. Refuses rather than creating the
 * goal itself: a milestone with nowhere to live is a sign the heading was
 * mistyped, not a note to write around it.
 */
export async function addMilestone(
	vault: Vault,
	path: string,
	heading: string,
	text: string,
	due: string | null
): Promise<MilestoneWrite> {
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'no-note' };

	const { content, line } = withNewMilestone(note.content, heading, text, due);
	const written = await vault.write(path, content, note.hash);
	if (!written.ok) return { ok: false, reason: 'conflict' };

	const task = parseTaskLine(content.split('\n')[line], line);
	return { ok: true, task: toTask(task!, path) };
}

/**
 * Habits: the things the user means to do every day, and how it is going.
 *
 * The specification, and the plan for this phase, said habits are recurring
 * tasks carrying the Tasks plugin's `🔁` field. The real vault contains not
 * one `🔁` anywhere. What it contains is `Journal/Journal Template.md`, whose
 * eighteen task lines — meditate, write in the journal, walk the dog — are
 * copied into each day's note and ticked there. That copy is the
 * habit list, so that is what this module reads, with `🔁` honoured as well
 * for the day the user starts using it.
 *
 * A habit is therefore identified by its words rather than by an id, because
 * words are all the vault gives us. `habitKey` is the one place that decides
 * when two lines are the same habit, so a change to the matching rule cannot
 * be made in two places and disagree.
 *
 * Nothing here writes. Ticking a habit goes through `updateTask`, the same
 * single-line rewrite every other checkbox in the hub uses.
 */

import { config } from '../config';
import { dailyNotePath, shiftDay } from '../daily';
import { FIELD } from '../parse/task';
import { displayText, isDone, type Task } from '$lib/shared/task';
import type { Habit, HabitDay } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';

export type { Habit, HabitDay };

/** How far back a streak is counted, and how much history the strip holds. */
const WINDOW = 30;

export interface HabitQuery {
	/** The day to treat as today, `YYYY-MM-DD`. */
	today: string;
	/** Days of history. Defaults to 30. */
	days?: number;
}

/**
 * Every habit, in the order the template lists them, which is the order the
 * user put them in.
 *
 * Reads the daily-note template for the list and the last `days` daily notes
 * for whether each was done. Never writes, and never creates a missing daily
 * note: a day the user did not write is a day with no data, not a failure.
 */
export async function habits(vault: Vault, index: NoteIndex, query: HabitQuery): Promise<Habit[]> {
	const template = index.tasksIn(config.dailyNote.template).filter((t) => !t.fenced);
	const days: Array<{ day: string; exists: boolean; tasks: Task[] }> = [];
	const span = query.days ?? WINDOW;

	for (let back = span - 1; back >= 0; back--) {
		const day = shiftDay(query.today, -back);
		const path = dailyNotePath(day);
		const note = await vault.read(path);
		days.push({ day, exists: note.exists, tasks: note.exists ? index.tasksIn(path).filter((t) => !t.fenced) : [] });
	}

	return habitsFrom({ template, days, today: query.today });
}

/**
 * The habit list and its streaks, as a pure function of the days it was given.
 *
 * A day with no daily note is a hole, not a miss: this user writes the journal
 * on the days they write it, and counting every unwritten Saturday as a
 * failure would make every streak one. So `streak` counts back over the days
 * that have a note, and `hit` of `of` tells the honest version alongside it.
 *
 * Today is never counted as a miss either, since the day is not over.
 */
export function habitsFrom(input: {
	/** Task lines from the daily-note template, in file order. */
	template: Task[];
	/** Oldest day first. */
	days: Array<{ day: string; exists: boolean; tasks: Task[] }>;
	today: string;
}): Habit[] {
	const candidates = new Map<string, { text: string; recurring: boolean }>();
	for (const task of input.template) {
		candidates.set(habitKey(task.text), { text: displayText(task.text), recurring: isRecurring(task) });
	}
	// A recurring task written anywhere counts, even if the template never
	// mentioned it, so adopting `🔁` does not mean editing the template first.
	for (const { tasks } of input.days) {
		for (const task of tasks) {
			if (!isRecurring(task)) continue;
			const key = habitKey(task.text);
			if (!candidates.has(key)) candidates.set(key, { text: displayText(task.text), recurring: true });
			else candidates.set(key, { ...candidates.get(key)!, recurring: true });
		}
	}

	return [...candidates.entries()].map(([key, { text, recurring }]) => {
		const days: HabitDay[] = input.days.map(({ day, exists, tasks }) => {
			const match = tasks.find((t) => habitKey(t.text) === key);
			return { day, done: exists && match ? isDone(match) : null };
		});

		const todayEntry = input.days.find((d) => d.day === input.today);
		const todayTask = todayEntry?.tasks.find((t) => habitKey(t.text) === key) ?? null;
		const seen = days.filter((d) => d.done !== null);

		return {
			text,
			recurring,
			today: todayTask ? isDone(todayTask) : null,
			path: todayTask?.path ?? null,
			line: todayTask?.line ?? null,
			raw: todayTask?.raw ?? null,
			streak: streak(days, input.today),
			hit: seen.filter((d) => d.done).length,
			of: seen.length,
			days
		};
	});
}

/**
 * How two task lines are recognised as the same habit.
 *
 * Markdown is reduced to its words and case and punctuation are thrown away,
 * so `- [ ] **Walk the dog & feed the cat**, check food` and
 * `- [x] 12:00 - 12:30 Walk the dog and feed the cat, check food` are one habit. The
 * time range is already off the text by the time the parser is done with it.
 */
export function habitKey(text: string): string {
	return displayText(text)
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Consecutive days done, counting back from today over the days that have a
 * note. Today counts when it is done and is skipped when it is not, because
 * an unfinished today is not yet a broken streak.
 */
function streak(days: HabitDay[], today: string): number {
	let count = 0;
	for (let i = days.length - 1; i >= 0; i--) {
		const entry = days[i];
		if (entry.done === null) continue;
		if (entry.done) count++;
		else if (entry.day === today) continue;
		else break;
	}
	return count;
}

function isRecurring(task: Task): boolean {
	return task.raw.includes(FIELD.recurrence);
}

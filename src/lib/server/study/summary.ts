/**
 * The one read every Study page starts from: a subject's goals, sessions
 * and reading list, and the roll-ups by goal the Overview and the Study
 * index show.
 *
 * Every subject page needs the same few files, and the Overview needs all
 * of them at once, so there is one function that reads them together rather
 * than each page re-deriving paths and reading a subset. The extra reads a
 * page pays for what it does not show are three short files.
 *
 * The roll-ups are pure functions of a summary, so the arithmetic that says
 * "four hours on Networks this week" is tested without a vault.
 */

import { findGoal, goalRefs, readGoals, type Goal, type GoalsNote } from './goals';
import { readReadingList } from './reading';
import { minutesByGoal, minutesInWeek, monthRange, readSessions, streak, weeklyMinutes, weekStart, type StudySession } from './sessions';
import { shiftDay } from '../daily';
import { daysBetween } from '$lib/shared/time';
import { isDone, isOpen, isSkipped, type Task } from '$lib/shared/task';
import type { FocusStep, GoalRef, ReadingItem, ReadingList, StudyFocus } from '$lib/shared/study';
import type { Subject } from './subjects';
import type { Vault } from '../vault/index';

interface StudySummary {
	subject: Subject;
	goals: GoalsNote;
	/** The goals as every picker offers them, in file order. */
	goalRefs: GoalRef[];
	sessions: StudySession[];
	reading: ReadingList;
}

/** Everything a subject's pages need, read once. Never writes; a missing file reads as empty. */
export async function studySummary(vault: Vault, subject: Subject): Promise<StudySummary> {
	const { files } = subject;
	const [goals, sessions, reading] = await Promise.all([
		readGoals(vault, files.goals),
		readSessions(vault, files.sessions),
		readReadingList(vault, subject)
	]);
	return { subject, goals, goalRefs: goalRefs(goals), sessions, reading };
}

/** One goal's standing, as the Overview shows it. */
interface GoalProgress extends GoalRef {
	target: string | null;
	/** Milestones ticked, and all of them. */
	done: number;
	total: number;
	/** The first milestone not yet ticked, or null. */
	next: { text: string; due: string | null } | null;
	/** Minutes logged against it this week. */
	weekMinutes: number;
	/** Reading-list items in the Reading group that name it. */
	reading: ReadingItem[];
}

/** What belongs to no goal, so the Overview can say so rather than drop it. */
interface Unassigned {
	weekMinutes: number;
	reading: ReadingItem[];
}

/**
 * Each goal with its milestones, this week's hours and the reading in
 * progress for it; and what points at no goal of this subject. Pure.
 *
 * An item or a session names a goal by its heading, and is
 * matched to it the way `findGoal` matches, ignoring case and punctuation;
 * one naming a goal that is not in `Goals.md` counts as unassigned.
 */
export function progressByGoal(summary: StudySummary, today: string): { goals: GoalProgress[]; unassigned: Unassigned } {
	const refs = summary.goalRefs;
	const start = weekStart(today);
	const week = minutesByGoal(summary.sessions, start, shiftDay(start, 7));
	const reading = summary.reading.groups.find((g) => g.title.trim().toLowerCase() === 'reading')?.items ?? [];
	const owner = (written: string | null) => findGoal(refs, written)?.name ?? null;

	const goals = summary.goals.goals.map((goal: Goal, i): GoalProgress => {
		const ref = refs[i];
		const next = goal.milestones.find(isOpen) ?? null;
		return {
			...ref,
			target: goal.target,
			done: goal.milestones.filter(isDone).length,
			// A skipped milestone is owed by nobody, so it is out of the total.
			total: goal.milestones.filter((m) => !isSkipped(m)).length,
			next: next ? { text: next.text, due: next.due } : null,
			weekMinutes: week.filter((m) => m.goal && owner(m.label) === ref.name).reduce((sum, m) => sum + m.minutes, 0),
			reading: reading.filter((item) => owner(item.goal) === ref.name)
		};
	});

	const weekTotal = week.reduce((sum, m) => sum + m.minutes, 0);
	const unassigned = {
		weekMinutes: weekTotal - goals.reduce((sum, g) => sum + g.weekMinutes, 0),
		reading: reading.filter((item) => owner(item.goal) === null)
	};
	return { goals, unassigned };
}

/** The reading-list groups a goal's resources come from, in the order shown: what is open first. */
const RESOURCE_GROUPS = [
	{ key: 'reading', group: 'Reading' },
	{ key: 'to read', group: 'To read' }
] as const;

/**
 * The one goal Overview shows, laid out as steps to take. Pure.
 *
 * The goal is the one `focus:` names in `Goals.md`; when it names none, or
 * one that is no longer there, it is the first goal, in file order, with a
 * step still open, so the order of the headings is the order of priority.
 * When every goal is finished it is the first goal. Null when there are no
 * goals.
 *
 * Its milestones become steps in file order: the first open one is `now`,
 * the open ones after it `later`, ticked ones `done`, and a cancelled one
 * `skipped`, out of the count. `daysLeft` is from `today` to the step's own
 * due date, negative once it has passed. Its resources are the reading
 * items that name it in Reading, then To read; Paused and Done are left out.
 */
export function focusOn(summary: StudySummary, today: string): StudyFocus | null {
	const { goals: progress } = progressByGoal(summary, today);
	const goals = summary.goals.goals;
	if (!goals.length) return null;

	const named = findGoal(summary.goalRefs, summary.goals.focus);
	const at = named ? summary.goalRefs.indexOf(named) : Math.max(0, goals.findIndex((g) => g.milestones.some(isOpen)));
	const goal = goals[at];
	const now = goal.milestones.find(isOpen) ?? null;
	const steps = goal.milestones.map((task: Task): FocusStep => ({
		task,
		state: task === now ? 'now' : isDone(task) ? 'done' : isSkipped(task) ? 'skipped' : 'later',
		daysLeft: task.due ? daysBetween(today, task.due) : null
	}));
	const owner = (written: string | null) => findGoal(summary.goalRefs, written)?.name ?? null;
	const resources = RESOURCE_GROUPS.flatMap(({ key, group }) =>
		(summary.reading.groups.find((g) => g.title.trim().toLowerCase() === key)?.items ?? [])
			.filter((item) => owner(item.goal) === goal.title)
			.map((item) => ({ ...item, group }))
	);

	return {
		...progress[at],
		index: at,
		chosen: named !== null,
		daysLeft: goal.target && /^\d{4}-\d{2}-\d{2}$/.test(goal.target) ? daysBetween(today, goal.target) : null,
		steps,
		resources
	};
}

/** A subject at a glance, for its card on the Study index. */
interface SubjectCard {
	slug: string;
	name: string;
	color: string;
	goals: Array<{ name: string; done: number; total: number }>;
	weekMinutes: number;
	streak: number;
}

/** A subject's index card, from its summary. Pure. */
export function subjectCard(summary: StudySummary, today: string): SubjectCard {
	const { subject, goals, sessions } = summary;
	return {
		slug: subject.slug,
		name: subject.name,
		color: subject.color,
		goals: goals.goals.map((g) => ({ name: g.title, done: g.milestones.filter(isDone).length, total: g.milestones.filter((m) => !isSkipped(m)).length })),
		weekMinutes: minutesInWeek(sessions, weekStart(today)),
		streak: streak(sessions, today)
	};
}

/**
 * Everything a subject's Overview, Goals, Reading and Sessions tabs show,
 * from one summary, for the subject's layout to load once. Pure.
 */
export function subjectView(summary: StudySummary, today: string) {
	const card = subjectCard(summary, today);
	const { goals: progress, unassigned } = progressByGoal(summary, today);
	const month = monthRange(today);
	return {
		goalRefs: summary.goalRefs,
		progress,
		focus: focusOn(summary, today),
		unassigned,
		reading: summary.reading,
		// Newest first, so the log reads like the inbox does.
		sessions: [...summary.sessions].sort((a, b) => b.day.localeCompare(a.day) || b.line - a.line),
		goalHours: minutesByGoal(summary.sessions, month.from, month.to),
		weeks: weeklyMinutes(summary.sessions, today, 8),
		weeklyHours: summary.goals.weeklyHours,
		weekMinutes: card.weekMinutes,
		streak: card.streak
	};
}

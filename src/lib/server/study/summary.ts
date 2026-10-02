/**
 * The one read every Study page starts from: a subject's goals and reading
 * list, and what the Overview and the Study index show of them.
 *
 * Every subject page needs the same two files, and the Overview needs both
 * at once, so there is one function that reads them together rather than
 * each page re-deriving paths and reading a subset.
 *
 * Everything after the read is a pure function of a summary, so which goal
 * is in focus and which step is next are tested without a vault.
 */

import { findGoal, goalRefs, readGoals, type Goal, type GoalsNote } from './goals';
import { readReadingList } from './reading';
import { daysBetween } from '$lib/shared/time';
import { isDone, isOpen, isSkipped, type Task } from '$lib/shared/task';
import type { FocusStep, GoalRef, ReadingList, StudyFocus } from '$lib/shared/study';
import type { Subject } from './subjects';
import type { Vault } from '../vault/index';

interface StudySummary {
	subject: Subject;
	goals: GoalsNote;
	/** The goals as every picker offers them, in file order. */
	goalRefs: GoalRef[];
	reading: ReadingList;
}

/** Everything a subject's pages need, read once. Never writes; a missing file reads as empty. */
export async function studySummary(vault: Vault, subject: Subject): Promise<StudySummary> {
	const { files } = subject;
	const [goals, reading] = await Promise.all([readGoals(vault, files.goals), readReadingList(vault, subject)]);
	return { subject, goals, goalRefs: goalRefs(goals), reading };
}

/** One goal's standing: what the Overview's row of goals and the Study index show. */
interface GoalProgress extends GoalRef {
	target: string | null;
	/** Milestones ticked, and all of them but the skipped. */
	done: number;
	total: number;
	/** The first milestone not yet ticked, or null. */
	next: { text: string; due: string | null } | null;
}

/** Each goal's milestones done out of total, and the next one, in file order. Pure. */
export function progressByGoal(summary: StudySummary): GoalProgress[] {
	return summary.goals.goals.map((goal: Goal, i): GoalProgress => {
		const next = goal.milestones.find(isOpen) ?? null;
		return {
			...summary.goalRefs[i],
			target: goal.target,
			done: goal.milestones.filter(isDone).length,
			// A skipped milestone is owed by nobody, so it is out of the total.
			total: goal.milestones.filter((m) => !isSkipped(m)).length,
			next: next ? { text: next.text, due: next.due } : null
		};
	});
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
	const progress = progressByGoal(summary);
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
}

/** A subject's index card, from its summary. Pure. */
export function subjectCard(summary: StudySummary): SubjectCard {
	const { subject } = summary;
	return {
		slug: subject.slug,
		name: subject.name,
		color: subject.color,
		goals: progressByGoal(summary).map(({ name, done, total }) => ({ name, done, total }))
	};
}

/**
 * Everything a subject's Overview, Goals and Reading tabs show, from one
 * summary, for the subject's layout to load once. Pure.
 */
export function subjectView(summary: StudySummary, today: string) {
	return {
		goalRefs: summary.goalRefs,
		progress: progressByGoal(summary),
		focus: focusOn(summary, today),
		reading: summary.reading
	};
}

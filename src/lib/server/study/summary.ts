/**
 * The one read every Study page starts from: a subject's goals, sessions,
 * reading list and cards, and the roll-ups by goal the Overview and the
 * Study index show.
 *
 * Every subject page needs the same few files, and the Overview needs all
 * of them at once, so there is one function that reads them together rather
 * than each page re-deriving paths and reading a subset. The extra reads a
 * page pays for what it does not show are small: three short files, and one
 * sweep of the vault for cards that `scope.ts` caches until something
 * changes.
 *
 * The roll-ups are pure functions of a summary, so the arithmetic that says
 * "four hours on Networks this week" is tested without a vault.
 */

import { dueCards, type CardQueue } from './flashcards';
import { newCardQuotas } from './new-cards';
import { findGoal, goalRefs, readGoals, type Goal, type GoalsNote } from './goals';
import { readReadingList } from './reading';
import { minutesByGoal, minutesInWeek, monthRange, readSessions, streak, weeklyMinutes, weekStart, type StudySession } from './sessions';
import { shiftDay } from '../daily';
import { isDone } from '$lib/shared/task';
import type { CardFile, GoalRef, ReadingItem, ReadingList } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Subject } from './subjects';
import type { Vault } from '../vault/index';

interface StudySummary {
	subject: Subject;
	goals: GoalsNote;
	/** The goals as every picker offers them, in file order. */
	goalRefs: GoalRef[];
	sessions: StudySession[];
	reading: ReadingList;
	cards: CardQueue;
}

/**
 * Everything a subject's pages need, read once. `goal`, a goal's name or
 * slug, narrows the card queue to that goal's files; the file list and every
 * other part stay whole. Never writes; a missing file reads as empty.
 */
export async function studySummary(
	vault: Vault,
	index: NoteIndex,
	subject: Subject,
	today: string,
	goal?: string
): Promise<StudySummary> {
	const { files } = subject;
	const [goals, sessions, reading] = await Promise.all([
		readGoals(vault, files.goals),
		readSessions(vault, files.sessions),
		readReadingList(vault, subject)
	]);
	const refs = goalRefs(goals);
	// A slug from a URL names the goal whose slug it is; anything else is taken as a name.
	const wanted = goal === undefined ? undefined : (refs.find((g) => g.slug === goal)?.name ?? goal);
	const queue = await dueCards(vault, index, { on: today, scope: subject.scope, goal: wanted, newCards: await newCardQuotas(vault, [subject], today) });
	// `Goals.md`'s `target:: <date>` reads as a card to the scanner; Study's
	// own files are never card files, so they are not reported as ones
	// Obsidian cannot see.
	const own = new Set(Object.values(files));
	const cards = { ...queue, invisible: queue.invisible.filter((n) => !own.has(n.path)) };
	return { subject, goals, goalRefs: refs, sessions, reading, cards };
}

/**
 * The cards due across every subject, for "Review everything due" and for
 * Today. One sweep over the union of the subjects' scopes, so a note two
 * subjects share is reviewed once, not twice. Each subject lets in its own
 * new cards for today, so the new cards here are exactly those of every
 * subject's own review. No subjects means no cards, never the whole vault.
 * Never writes.
 */
export async function dueEverywhere(
	vault: Vault,
	index: NoteIndex,
	subjects: Subject[],
	today: string,
	limit?: number
): Promise<CardQueue> {
	const folders = [...new Set(subjects.flatMap((s) => s.scope.folders ?? []))];
	const tags = [...new Set(subjects.flatMap((s) => s.scope.tags ?? []))];
	if (!folders.length && !tags.length) return { cards: [], due: 0, fresh: 0, waiting: 0, total: 0, files: [], invisible: [] };
	return dueCards(vault, index, { on: today, scope: { folders, tags }, limit, newCards: await newCardQuotas(vault, subjects, today) });
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
	/** Cards ready to review today in files whose `goal:` names it. */
	due: number;
}

/** What belongs to no goal, so the Overview can say so rather than drop it. */
interface Unassigned {
	weekMinutes: number;
	reading: ReadingItem[];
	due: number;
}

/**
 * Each goal with its milestones, this week's hours, the reading in progress
 * for it and the cards due for it; and what points at no goal of this
 * subject. Pure.
 *
 * An item, a session or a card file names a goal by its heading, and is
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
		const next = goal.milestones.find((m) => !isDone(m)) ?? null;
		return {
			...ref,
			target: goal.target,
			done: goal.milestones.filter(isDone).length,
			total: goal.milestones.length,
			next: next ? { text: next.text, due: next.due } : null,
			weekMinutes: week.filter((m) => m.goal && owner(m.label) === ref.name).reduce((sum, m) => sum + m.minutes, 0),
			reading: reading.filter((item) => owner(item.goal) === ref.name),
			due: summary.cards.files.filter((f) => owner(f.goal) === ref.name).reduce((sum, f) => sum + f.due, 0)
		};
	});

	const weekTotal = week.reduce((sum, m) => sum + m.minutes, 0);
	const unassigned = {
		weekMinutes: weekTotal - goals.reduce((sum, g) => sum + g.weekMinutes, 0),
		reading: reading.filter((item) => owner(item.goal) === null),
		due: summary.cards.files.filter((f) => owner(f.goal) === null).reduce((sum, f) => sum + f.due, 0)
	};
	return { goals, unassigned };
}

/** Card files under one goal, or under none. */
interface CardFileGroup {
	/** Null for the files that name no goal, or one `Goals.md` does not have. */
	goal: GoalRef | null;
	files: CardFile[];
	/** Cards ready to review today across the group. */
	due: number;
}

/**
 * The subject's card files grouped by goal, in `Goals.md` order, with the
 * files under no goal last. A goal with no files is left out. Pure.
 */
export function filesByGoal(summary: StudySummary): CardFileGroup[] {
	const groups: CardFileGroup[] = [...summary.goalRefs.map((goal) => ({ goal, files: [] as CardFile[], due: 0 })), { goal: null, files: [], due: 0 }];
	for (const file of summary.cards.files) {
		const owner = findGoal(summary.goalRefs, file.goal);
		const group = (owner && groups.find((g) => g.goal?.name === owner.name)) || groups[groups.length - 1];
		group.files.push(file);
		group.due += file.due;
	}
	return groups.filter((g) => g.files.length > 0);
}

/** A subject at a glance, for its card on the Study index. */
interface SubjectCard {
	slug: string;
	name: string;
	color: string;
	goals: Array<{ name: string; done: number; total: number }>;
	weekMinutes: number;
	/** Cards ready to review today. */
	due: number;
	streak: number;
}

/** A subject's index card, from its summary. Pure. */
export function subjectCard(summary: StudySummary, today: string): SubjectCard {
	const { subject, goals, sessions, cards } = summary;
	return {
		slug: subject.slug,
		name: subject.name,
		color: subject.color,
		goals: goals.goals.map((g) => ({ name: g.title, done: g.milestones.filter(isDone).length, total: g.milestones.length })),
		weekMinutes: minutesInWeek(sessions, weekStart(today)),
		due: cards.files.reduce((sum, f) => sum + f.due, 0),
		streak: streak(sessions, today)
	};
}

/**
 * Everything a subject's Overview, Flashcards, Reading and Sessions tabs
 * show, from one summary, for the subject's layout to load once. Pure.
 *
 * The card queue itself is left out: it holds every due card's text, which
 * only the review needs, and the layout's data goes to every tab.
 */
export function subjectView(summary: StudySummary, today: string) {
	const card = subjectCard(summary, today);
	const { goals: progress, unassigned } = progressByGoal(summary, today);
	const month = monthRange(today);
	return {
		goalRefs: summary.goalRefs,
		progress,
		unassigned,
		groups: filesByGoal(summary),
		reading: summary.reading,
		// Newest first, so the log reads like the inbox does.
		sessions: [...summary.sessions].sort((a, b) => b.day.localeCompare(a.day) || b.line - a.line),
		goalHours: minutesByGoal(summary.sessions, month.from, month.to),
		weeks: weeklyMinutes(summary.sessions, today, 8),
		due: card.due,
		fresh: summary.cards.fresh,
		waiting: summary.cards.waiting,
		total: summary.cards.total,
		invisible: summary.cards.invisible,
		weeklyHours: summary.goals.weeklyHours,
		weekMinutes: card.weekMinutes,
		streak: card.streak
	};
}

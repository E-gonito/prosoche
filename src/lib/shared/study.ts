/**
 * The vocabulary of the study section: what a card, a resource, a topic and a
 * habit are.
 *
 * These shapes are the contract between the server modules that read them out
 * of the markdown, the API routes that serialise them and the five widgets
 * that render them. They live in `shared/` because all three sides need them
 * and neither side may import the other: a component must never reach into
 * `$server`, and a server module must never pull a browser module into its
 * bundle.
 *
 * Everything here is data. The browser's calls against these shapes are in
 * `$lib/client/study`, and the arithmetic that schedules a card is in
 * `$lib/shared/sm2`.
 */

import type { Grade, Schedule } from './sm2';

export type { Grade, Schedule };

/**
 * Which part of the vault a study query covers.
 *
 * Empty means the whole vault, which is what the global study page wants. A
 * workspace tab passes its own folders and tag, which is what lets the same
 * widget sit on the CS study page and on the Personal dashboard and show
 * different things without knowing that either page exists.
 */
export interface StudyScope {
	/** Vault-relative folders. A note under one of them is in scope. */
	folders?: string[];
	/** Tags on the note, without `#`. A note carrying one is in scope. */
	tags?: string[];
}

/** How a card is written in the markdown, in Spaced Repetition's terms. */
export type CardKind = 'inline' | 'inline-reversed' | 'multiline' | 'multiline-reversed' | 'cloze';

/**
 * One flashcard, identified by where it is rather than by what it says.
 *
 * A card is a region of a note, so `path` and `line` are its identity and
 * `expectedRaw` is the line the hub will rewrite, carried to the browser and
 * back so a grade cannot land on a line that changed underneath. Nothing here
 * is a copy of state the markdown does not hold.
 */
export interface Card {
	path: string;
	/** First line of the card, 0-based, as the file numbers lines. */
	line: number;
	/** Last line of the card's own text, before any schedule comment. */
	endLine: number;
	kind: CardKind;
	/** The prompt, as markdown. */
	question: string;
	/** The answer, as markdown. For a cloze, the hidden text revealed. */
	answer: string;
	/** Note title and heading trail, so a card out of context is still placed. */
	context: string;
	/** Deck from `#flashcards/<deck>`, else the note's folder. */
	deck: string;
	schedule: Schedule | null;
	/** Which of the schedules in the comment belongs to this card. */
	index: number;
	/** How many sibling cards share the comment; 1 for everything but clozes. */
	siblings: number;
	/** Line the schedule is written on, or the line it will be written after. */
	scheduleLine: number;
	/** True when `scheduleLine` already holds a comment to rewrite. */
	scheduleExists: boolean;
	/** `scheduleLine` as it stood when read, for per-line conflict detection. */
	expectedRaw: string;
}

/** What a due-card query answers. */
export interface CardQueue {
	/** Cards to review, most overdue first, then new ones. */
	cards: Card[];
	/** Cards already due or overdue, among `cards`. */
	due: number;
	/** Cards never reviewed, among `cards`. */
	fresh: number;
	/** Total cards in scope, reviewed or not. */
	total: number;
	/**
	 * Notes holding cards that Obsidian cannot see, because the note carries no
	 * flashcard tag. Surfaced rather than silently included, so the fix is one
	 * the user can make in Obsidian.
	 */
	invisible: Array<{ path: string; title: string; cards: number }>;
}

export type ResourceStatus = 'queued' | 'learning' | 'paused' | 'done';
export type ResourceKind = 'course' | 'book' | 'article' | 'video' | 'lab' | 'paper' | 'note';

/** Something the user is reading, watching or working through. */
export interface Resource {
	path: string;
	title: string;
	kind: ResourceKind;
	url: string | null;
	status: ResourceStatus;
	/** True when `status` came from the note rather than being inferred. */
	stated: boolean;
	/** 0..100, from `progress:` or from the note's own task list. */
	progress: number;
	/** Topic ids from `topics:`, plus the folders the note lives in. */
	topics: string[];
	/** `added:` if stated, else null. */
	added: string | null;
	/** Last modification, for ordering when nothing better is available. */
	updatedMs: number;
	tasksDone: number;
	tasksTotal: number;
}

/** A node of the topic map. */
export interface Topic {
	/** Stable slug, unique within a scope. */
	id: string;
	name: string;
	/** Parent topic id, or null at the root of the map. */
	parent: string | null;
	/** The folder or note this topic came from, for a link. */
	path: string | null;
	/**
	 * Where the topic was found: a folder in the scope, a heading in a syllabus
	 * note, or a note declaring `type: topic` in its frontmatter.
	 */
	kind: 'folder' | 'heading' | 'declared';
	/** Notes filed under it. */
	notes: number;
	/** Checklist items under a syllabus heading, and how many are ticked. */
	done: number;
	total: number;
}

/** A topic with what is covering it, which is the point of the map. */
export interface TopicCoverage extends Topic {
	resources: number;
	/** Resources under way or finished, as opposed to merely queued. */
	started: number;
	cards: number;
	cardsDue: number;
	/**
	 * `covered` has resources and cards, `started` has one of the two, `gap`
	 * has neither and is what the map exists to show.
	 */
	state: 'covered' | 'started' | 'gap';
}

/** One day of a habit, for the streak strip. */
export interface HabitDay {
	day: string;
	/** null when the day has no note at all, so a gap is not a failure. */
	done: boolean | null;
}

export interface Habit {
	/** The task text, with markdown reduced to words. */
	text: string;
	/** True when the task carries the Tasks plugin's recurrence field. */
	recurring: boolean;
	/** Today's state. `null` means today's note does not carry the habit. */
	today: boolean | null;
	/** The task line in today's note, so it can be ticked from the widget. */
	path: string | null;
	line: number | null;
	raw: string | null;
	/** Consecutive days up to and including yesterday, plus today if done. */
	streak: number;
	/** Days done out of the days that had a note, over the window. */
	hit: number;
	of: number;
	/** Oldest day first, so the strip reads left to right. */
	days: HabitDay[];
}

/** Lines inserted into a note, which moves every card below them. */
export interface CardShift {
	path: string;
	afterLine: number;
	by: number;
}

export interface Graded {
	card: Card;
	/** Set when the write inserted a line, so a held queue can be corrected. */
	shift: CardShift | null;
}

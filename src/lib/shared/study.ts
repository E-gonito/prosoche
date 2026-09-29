/**
 * The vocabulary of the study section: what a subject, a goal, a card, a card
 * file and a reading-list item are.
 *
 * These shapes are the contract between the server modules that read them out
 * of the markdown, the API routes that serialise them and the screens that
 * render them. They live in `shared/` because both sides need them and
 * neither side may import the other: a component must never reach into
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
 * Which part of the vault a study query covers: a subject's folders and tag.
 * Empty means the whole vault.
 */
export interface StudyScope {
	/** Vault-relative folders. A note under one of them is in scope. */
	folders?: string[];
	/** Tags on the note, without `#`. A note carrying one is in scope. */
	tags?: string[];
}

/**
 * A subject: one workspace whose `template:` says `study`, as the screens
 * need it. Its own files live in `home`; its cards come from every folder
 * its workspace names.
 */
export interface SubjectRef {
	/** The workspace's slug, and the `/study/<slug>` segment. */
	slug: string;
	name: string;
	color: string;
	/** Home folder: where `Goals.md`, `Reading List.md`, `Sessions.md` and `Flashcards/` live. */
	home: string;
}

/**
 * A goal, as every goal picker offers it. A goal is a `## ` heading in the
 * subject's `Goals.md`, and it is the subject's unit of progress: reading
 * items, sessions and card files point at one.
 */
export interface GoalRef {
	/** The heading's text, verbatim. */
	name: string;
	/** For a URL such as `/study/<subject>/review?goal=<slug>`. */
	slug: string;
	/** The wikilink written into a reading item or a session: `[[Goals#<name>]]`. */
	link: string;
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

/**
 * A note holding cards, and the goal its frontmatter's `goal:` puts them
 * under. The Flashcards tab lists these, grouped by goal.
 */
export interface CardFile {
	path: string;
	title: string;
	/** `goal:` as the note names it, or null when it names none. */
	goal: string | null;
	/** Every card in the file. */
	cards: number;
	/** Cards ready to review today: due, overdue, or never reviewed. */
	due: number;
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
	/** Every card source in scope, in path order, whatever the goal asked for. */
	files: CardFile[];
	/**
	 * Notes holding cards that Obsidian cannot see, because the note carries no
	 * flashcard tag. Surfaced rather than silently included, so the fix is one
	 * the user can make in Obsidian.
	 */
	invisible: Array<{ path: string; title: string; cards: number }>;
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

/** What a reading-list item is, written as its `#tag`; `other` is written as no tag. */
export const READING_KINDS = ['book', 'course', 'video', 'article', 'paper', 'other'] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

/** The columns of a reading list that has never been written, in order. */
export const READING_COLUMNS = ['To read', 'Reading', 'Paused', 'Done'] as const;

/** An item's own fields: what the add and edit forms send. */
export interface ReadingFields {
	title: string;
	/** Where to read it, or null. */
	url: string | null;
	kind: ReadingKind;
	/** The goal's name, or null for none. */
	goal: string | null;
}

/** One item on the reading list: a card on its board. */
export interface ReadingItem extends ReadingFields {
	/** 0-based line of its `- [ ]` line in `Reading List.md`. */
	line: number;
	done: boolean;
}

/** A column of the reading list, shown as a group. */
export interface ReadingGroup {
	title: string;
	items: ReadingItem[];
}

export interface ReadingList {
	/** The subject's slug. */
	subject: string;
	path: string;
	/** Hash of the bytes this list was read from; send it back with an op. */
	hash: string;
	/** False for a list that has never been written: the default columns. */
	exists: boolean;
	groups: ReadingGroup[];
}

/**
 * Everything the reading list can be asked to do. Items are addressed by
 * line and groups by index, and each op travels with the hash of the file it
 * was computed against, exactly as a workspace board's ops do.
 */
export type ReadingOp =
	| { kind: 'add'; group: number; item: ReadingFields }
	/** Only what differs from the item as it is is rewritten. */
	| { kind: 'edit'; line: number; item: ReadingFields }
	/** `index` is the item's position in the target group once it is there. */
	| { kind: 'move'; line: number; group: number; index: number }
	| { kind: 'delete'; line: number };

/** One tab of a subject's own tab bar. Every one always shows. */
export interface StudyTab {
	title: string;
	/** The path under `/study/<subject>`: '' for Overview. */
	path: string;
}

/** A subject's tabs, in order. A fresh subject shows all of them, to be filled in. */
export const STUDY_TABS: StudyTab[] = [
	{ title: 'Overview', path: '' },
	{ title: 'Goals', path: '/goals' },
	{ title: 'Reading list', path: '/reading' },
	{ title: 'Sessions', path: '/sessions' },
	{ title: 'Flashcards', path: '/flashcards' }
];

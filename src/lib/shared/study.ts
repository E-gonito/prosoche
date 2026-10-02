/**
 * The vocabulary of the study section: what a subject, a goal and a
 * reading-list item are.
 *
 * These shapes are the contract between the server modules that read them out
 * of the markdown, the API routes that serialise them and the screens that
 * render them. They live in `shared/` because both sides need them and
 * neither side may import the other: a component must never reach into
 * `$server`, and a server module must never pull a browser module into its
 * bundle.
 *
 * Everything here is data. Flashcards are not Study's: see
 * `$lib/shared/flashcards`.
 */

import type { Task } from './task';

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
 * A subject: one file in `_hub/subjects/`, as the screens need it. Its own
 * files live in `home`; its notes come from every folder its file names.
 */
export interface SubjectRef {
	/** The subject file's name, and the `/study/<slug>` segment. */
	slug: string;
	name: string;
	color: string;
	/** Home folder: where `Goals.md`, `Reading List.md` and `Sessions.md` live. */
	home: string;
}

/**
 * A goal, as every goal picker offers it. A goal is a `## ` heading in the
 * subject's `Goals.md`, and it is the subject's unit of progress: reading
 * items and sessions point at one.
 */
export interface GoalRef {
	/** The heading's text, verbatim. */
	name: string;
	/** For a URL such as `/study/<subject>/review?goal=<slug>`. */
	slug: string;
	/** The wikilink written into a reading item or a session: `[[Goals#<name>]]`. */
	link: string;
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
interface ReadingGroup {
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

/** One milestone of the goal in focus, as a step: done, the one to do now, one for later, or skipped. */
export interface FocusStep {
	task: Task;
	state: 'done' | 'now' | 'later' | 'skipped';
	/** Days from today to the step's due date, negative once it has passed; null with no date. */
	daysLeft: number | null;
}

/** The one goal a subject's Overview shows, and what it takes, step by step. */
export interface StudyFocus extends GoalRef {
	target: string | null;
	/** Steps ticked, and all of them but the skipped. */
	done: number;
	total: number;
	/** Minutes logged against it this week. */
	weekMinutes: number;
	/** Its place among the goals, 0-based, in file order. */
	index: number;
	/** True when `focus:` in `Goals.md` chose it, false when it was picked as the first unfinished. */
	chosen: boolean;
	/** Days from today to its `target::`, negative once it has passed; null with none. */
	daysLeft: number | null;
	/** Its milestones in file order. */
	steps: FocusStep[];
	/** Reading items for it, Reading first, then To read. */
	resources: Array<ReadingItem & { group: 'Reading' | 'To read' }>;
}

/** One tab of a subject's own tab bar. Every one always shows. */
interface StudyTab {
	title: string;
	/** The path under `/study/<subject>`: '' for Overview. */
	path: string;
}

/** A subject's tabs, in order. A fresh subject shows all of them, to be filled in. */
export const STUDY_TABS: StudyTab[] = [
	{ title: 'Overview', path: '' },
	{ title: 'Notes', path: '/notes' },
	{ title: 'Goals', path: '/goals' },
	{ title: 'Reading list', path: '/reading' },
	{ title: 'Sessions', path: '/sessions' }
];

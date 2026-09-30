/**
 * The vocabulary of flashcards: what a card, a card file and a queue of
 * cards to review are.
 *
 * These shapes are the contract between the server modules that read them
 * out of the markdown (`$server/flashcards`), the API routes that serialise
 * them and the review screen. They live in `shared/` because both sides
 * need them and neither may import the other. The browser's calls are in
 * `$lib/client/flashcards`, and the arithmetic that schedules a card is in
 * `$lib/shared/scheduler`.
 */

import type { Grade, Schedule } from './scheduler';

export type { Grade, Schedule };

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

/** A note holding cards: in a deck, one category's file. */
export interface CardFile {
	path: string;
	/** Every card in the file. */
	cards: number;
	/** Cards ready to review today: due, overdue, or new today. */
	due: number;
}

/** What a due-card query answers. */
export interface CardQueue {
	/** Cards to review: those reviewed before, then new ones, the decks taking turns. */
	cards: Card[];
	/** Cards already due or overdue, among `cards`. */
	due: number;
	/** Cards never reviewed that join today, among `cards`: today's new cards. */
	fresh: number;
	/** Cards never reviewed that are not among today's new cards: they wait for a later day. */
	waiting: number;
	/** Total cards in scope, reviewed or not. */
	total: number;
	/** Every card file in scope, in path order. */
	files: CardFile[];
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

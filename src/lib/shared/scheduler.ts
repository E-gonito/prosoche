/**
 * Flashcard scheduling: Anki's FSRS, through its official TypeScript port.
 *
 * This is the only file that imports `ts-fsrs`. It turns a card's state and
 * a day into what each of the four answers would do next, so the server
 * grading a card and the review screen labelling its buttons run the same
 * arithmetic on the same inputs. How that state is written into a note is
 * `flashcards.ts`'s business; nothing here knows the comment grammar.
 *
 * A calendar day is a label, not an instant, so every review is taken to
 * happen at noon UTC on the day it is credited to. That makes elapsed days
 * whole, keeps the result independent of the clock and the time zone, and
 * makes FSRS's fuzz deterministic: its seed is the review time, the review
 * count and the memory state, so the browser's preview and the server's
 * grade always agree.
 *
 * The tuning lives here rather than in `server/config.ts` because the
 * browser needs it too, to preview the buttons, and that file is server-only.
 * It is the app's tuning, not the user's data, so it is not in the vault.
 */

import { fsrs, Rating, State, type Card as FsrsCard, type Grade as FsrsGrade } from 'ts-fsrs';
import { addDays, daysBetween } from './time';

/** The four answers, in the order the review UI shows them and keys 1-4 pick. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'] as const;

/** Where a card is in FSRS's life cycle once it has been answered at least once. */
export type CardState = 'learning' | 'review' | 'relearning';

/**
 * What the vault stores about one card side: FSRS's memory state and
 * nothing else. A card never answered has no schedule at all (null).
 */
export interface Schedule {
	/** Day the card is next due, `YYYY-MM-DD`. */
	due: string;
	/** Days until recall probability falls to 90%. Two decimals. */
	stability: number;
	/** 1 (easy) to 10 (hard). Two decimals. */
	difficulty: number;
	/** Times answered. */
	reps: number;
	/** Times forgotten after it had been learnt. */
	lapses: number;
	state: CardState;
	/** Day it was last answered, `YYYY-MM-DD`. */
	last: string;
}

/** What one answer would do: the state to write, and how the button says it. */
export interface Outcome {
	schedule: Schedule;
	/** "10 min", "3 days", "2 mo", "1.2 yr". */
	label: string;
}

/**
 * Anki's defaults (FSRS weights, 90% desired retention, a 100-year cap)
 * with two choices of prosoche's own:
 *
 *  - One learning step of ten minutes, not Anki's 1m and 10m. With a single
 *    step a learning card is always on step 0, so the step index is not
 *    state the comment has to hold; and a one-minute step means nothing to
 *    an app that knows days, not minutes.
 *  - Fuzz on. It is seeded from the inputs, so it spreads due dates without
 *    making the preview and the grade disagree.
 */
const scheduler = fsrs({
	request_retention: 0.9,
	maximum_interval: 36500,
	enable_fuzz: true,
	enable_short_term: true,
	learning_steps: ['10m'],
	relearning_steps: ['10m']
});

const RATING: Record<Grade, FsrsGrade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };
const STATE: Record<CardState, State> = { learning: State.Learning, review: State.Review, relearning: State.Relearning };

/**
 * What each answer would do to a card with schedule `current` (null when
 * it was never answered), answered on `today` (`YYYY-MM-DD`).
 *
 * Pure and deterministic: the same inputs give the same four outcomes on
 * the server and in the browser. Stability and difficulty are rounded to
 * two decimals, so a card's comment is stable across reviews and a state
 * read back from the vault schedules exactly as the one written. Never
 * mutates `current`, never reads a clock, and never returns a due day
 * before `today`.
 */
export function outcomes(current: Schedule | null, today: string): Record<Grade, Outcome> {
	const now = noon(today);
	const preview = scheduler.repeat(current ? toFsrs(current) : empty(now), now);
	const out = {} as Record<Grade, Outcome>;
	for (const grade of GRADES) {
		const next = preview[RATING[grade]].card;
		out[grade] = { schedule: fromFsrs(next), label: label(next.due.getTime() - now.getTime()) };
	}
	return out;
}

/**
 * A card last scheduled by SM-2 (the Obsidian Spaced Repetition plugin's
 * `!due,interval,ease`), read as FSRS state so it can be reviewed here.
 *
 * It is a review card whose stability is its interval (at least a day) and
 * whose difficulty follows its ease: 130%, SM-2's floor, is the hardest,
 * 10; 250%, its starting ease, is 5; higher eases are easier still, down
 * to 1. It was last answered `interval` days before it fell due. SM-2 does
 * not count reviews, so it is taken to have had one. Pure.
 */
export function fromSm2(due: string, interval: number, ease: number): Schedule {
	return {
		due,
		stability: Math.max(1, interval),
		difficulty: round(Math.min(10, Math.max(1, 10 - ((ease - 130) * 5) / 120))),
		reps: 1,
		lapses: 0,
		state: 'review',
		last: addDays(due, -interval)
	};
}

function toFsrs(s: Schedule): FsrsCard {
	return {
		due: noon(s.due),
		stability: s.stability,
		difficulty: s.difficulty,
		elapsed_days: 0,
		scheduled_days: Math.max(0, daysBetween(s.last, s.due)),
		learning_steps: 0,
		reps: s.reps,
		lapses: s.lapses,
		state: STATE[s.state],
		last_review: noon(s.last)
	};
}

function fromFsrs(c: FsrsCard): Schedule {
	const state = c.state === State.Learning ? 'learning' : c.state === State.Relearning ? 'relearning' : 'review';
	return {
		due: c.due.toISOString().slice(0, 10),
		stability: Math.max(0.01, round(c.stability)),
		difficulty: round(c.difficulty),
		reps: c.reps,
		lapses: c.lapses,
		state,
		last: (c.last_review ?? c.due).toISOString().slice(0, 10)
	};
}

function empty(now: Date): FsrsCard {
	return { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: State.New };
}

/** Noon UTC on `day`: an instant no time zone moves onto another day. */
function noon(day: string): Date {
	return new Date(`${day}T12:00:00.000Z`);
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * An interval as a person would say it, for the hint under a grade button.
 * Rounded rather than precise: "3 mo" is the useful part, not 91 days.
 */
function label(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1440) return `${minutes} min`;
	const days = Math.round(minutes / 1440);
	if (days === 1) return '1 day';
	if (days < 30) return `${days} days`;
	if (days < 365) return `${Math.round(days / 30.4)} mo`;
	return `${Math.round(days / 36.5) / 10} yr`;
}

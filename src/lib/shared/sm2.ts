/**
 * SM-2 scheduling, as the Obsidian Spaced Repetition plugin computes it.
 *
 * This is the whole of the hub's review arithmetic, kept pure so it can be
 * table-tested and so the review page can preview the next interval without a
 * round trip. There is no clock in here: every function takes the day it
 * should treat as today, because a calendar day is a label the caller owns.
 *
 * The numbers are not a generic SM-2. They reproduce `osrSchedule` from
 * Spaced Repetition 1.15.4, the version installed in this vault, so that a
 * card graded in the hub gets the same interval and ease it would have got in
 * Obsidian. Ease is a percentage, the way the plugin writes it: 250 means 2.5.
 *
 * One deliberate difference: the plugin spreads long intervals over
 * neighbouring days using a histogram of every due date in the vault, which
 * needs state this module refuses to hold. The hub rounds instead. The result
 * always lands inside the window the plugin's own fuzz would have chosen, and
 * the ease — the part that compounds — is identical.
 */

/** The four answers, in the order the review UI shows them and keys 1-4 pick. */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'] as const;

/** What the vault stores about one card, and all this module needs to know. */
export interface Schedule {
	/** Day the card is next due, `YYYY-MM-DD`. */
	due: string;
	/** Whole days between reviews. 0 means "again today". */
	interval: number;
	/** Ease as a percentage: 250 is the plugin's default 2.5. */
	ease: number;
}

export interface SchedulingRules {
	/** Ease a card starts with. */
	baseEase: number;
	/** Extra multiplier when an answer was easy. */
	easyBonus: number;
	/** What a hard answer multiplies the interval by. */
	lapseIntervalChange: number;
	/** Ease can never fall below this, however often a card is failed. */
	minEase: number;
	maxInterval: number;
}

/**
 * The plugin's shipped defaults, which are also the settings in this vault
 * (`.obsidian/plugins/obsidian-spaced-repetition/data.json`). They live here
 * as constants rather than being read from that file, because the hub never
 * reads Obsidian's configuration directory; if the user retunes the plugin,
 * this is the one place to follow.
 */
export const OSR: SchedulingRules = {
	baseEase: 250,
	easyBonus: 1.3,
	lapseIntervalChange: 0.5,
	minEase: 130,
	maxInterval: 36525
};

/** A card the user has never answered. The plugin's first interval is one day. */
export const NEW_INTERVAL = 1;

/**
 * The next schedule for a card, given the one it has and how it was answered.
 *
 * `current` is null for a card that has never been reviewed. `today` is the
 * day being credited with the review, `YYYY-MM-DD`.
 *
 * Reviewing late is rewarded: the days the card sat overdue count towards the
 * next interval, in the proportion the plugin uses per grade. Reviewing early
 * is not punished and earns nothing, so a card answered ahead of its due date
 * advances exactly as far as it would have on the day.
 *
 * Never mutates `current`, never consults a clock, and never returns an
 * interval outside 0..maxInterval or an ease below `minEase`.
 */
export function schedule(
	current: Schedule | null,
	grade: Grade,
	today: string,
	rules: SchedulingRules = OSR
): Schedule {
	const startEase = current?.ease ?? rules.baseEase;
	const startInterval = Math.max(1, current?.interval ?? NEW_INTERVAL);
	const late = current ? Math.max(0, daysBetween(current.due, today)) : 0;

	let ease = startEase;
	let interval: number;
	switch (grade) {
		case 'easy':
			ease = startEase + 20;
			interval = ((startInterval + late) * ease) / 100 * rules.easyBonus;
			break;
		case 'good':
			interval = ((startInterval + late / 2) * ease) / 100;
			break;
		case 'hard':
			ease = Math.max(rules.minEase, startEase - 20);
			interval = Math.max(1, (startInterval + late / 4) * rules.lapseIntervalChange);
			break;
		case 'again':
			// A lapse drops the interval to nothing, so the card returns today,
			// but the floor is the day itself: it is never scheduled backwards.
			ease = Math.max(rules.minEase, startEase - 20);
			interval = 0;
			break;
	}

	const days = Math.min(Math.max(0, Math.round(interval)), rules.maxInterval);
	return { due: addDays(today, days), interval: days, ease };
}

/**
 * Whether a card should be shown on `on`. A card with no schedule is new, and
 * new cards are always available, which is how the plugin treats them too.
 */
export function isDue(current: Schedule | null, on: string): boolean {
	return current === null || current.due <= on;
}

/** `day` plus `days`, as `YYYY-MM-DD`. Negative counts move backwards. */
export function addDays(day: string, days: number): string {
	const at = new Date(utc(day) + days * 86_400_000);
	return at.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is the earlier day. */
export function daysBetween(from: string, to: string): number {
	return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * An interval as a person would say it, for the hint under a grade button.
 * Rounded rather than precise: "3mo" is the useful part, not 91 days.
 */
export function intervalLabel(days: number): string {
	if (days <= 0) return 'today';
	if (days === 1) return '1 day';
	if (days < 30) return `${days} days`;
	if (days < 365) return `${Math.round(days / 30.4)} mo`;
	return `${Math.round(days / 36.5) / 10} yr`;
}

/**
 * Midnight UTC for a `YYYY-MM-DD` label. Going through UTC rather than the
 * local Date parser is what keeps day arithmetic from drifting by one across a
 * daylight-saving boundary.
 */
function utc(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, (m || 1) - 1, d || 1);
}

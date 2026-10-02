/**
 * Likes sent, as forecasts to be scored: the record the Date module keeps for
 * each one, and the numbers that say how well the forecasts are calibrated.
 *
 * Shared by the server, which reads and writes the records, and the pages,
 * which show them. The record lives in a person's note under
 * `Private/Dating/People/`; `server/parse/like.ts` is the only place that
 * knows how its fields are spelled there.
 */

/**
 * The outcome every forecast predicts, in one place so every label agrees:
 * yes means she matched and then replied; a match she never answers is no.
 */
export const OUTCOME = 'she replies after matching';
export const FORECAST_LABEL = `Chance ${OUTCOME}`;

/** A pending like older than this many days (sentDate + N < today) becomes no. */
export const AUTO_RESOLVE_DAYS = 7;

/** The forecast bounds: 0 is saved as 2 and 100 as 98, since neither is ever certain. */
export const FORECAST_MIN = 2;
export const FORECAST_MAX = 98;

/** Below this many records a group's numbers are noise, so they are not shown. */
export const MIN_GROUP = 10;

export const LIKE_STATUSES = ['pending', 'yes', 'no'] as const;
export type LikeStatus = (typeof LIKE_STATUSES)[number];

export const LIKED_ON = ['photo', 'prompt'] as const;
export type LikedOn = (typeof LIKED_ON)[number];

/** One like sent. Every `null` means unknown, never false. */
export interface Like {
	/** The note's file name, which is also the label. Stable: the label is not renamed here. */
	id: string;
	/** A nickname, never a full name. */
	label: string;
	sentDate: string;
	/** Whole percent, FORECAST_MIN–FORECAST_MAX. */
	forecast: number;
	outOfLeague: boolean | null;
	fitsType: boolean | null;
	age: number | null;
	likedOn: LikedOn | null;
	commented: boolean | null;
	status: LikeStatus;
	resolvedDate: string | null;
	resolvedBy: 'manual' | 'auto' | null;
	/** The note's free text, without its title or its dates log. */
	notes: string;
	/** True when the migration had to supply `sentDate` because the note had none. */
	sentDateMigrated: boolean;
	/** The note's content hash, to send back with an edit. */
	hash: string;
}

/** The fields a person may set on a like; the rest follow from them. */
export type LikeFields = Pick<Like, 'sentDate' | 'forecast' | 'outOfLeague' | 'fitsType' | 'age' | 'likedOn' | 'commented'>;

/** A forecast as typed, as a whole percent the record can hold. Pure. */
export function clampForecast(value: number): number {
	return Math.min(FORECAST_MAX, Math.max(FORECAST_MIN, Math.round(value)));
}

/** One group of resolved likes, scored. */
export interface LikeGroup {
	name: string;
	n: number;
	/** False below MIN_GROUP, when the page says "not enough data" instead of the numbers. */
	enough: boolean;
	/** Mean forecast, 0–1; null for an empty group. */
	meanForecast: number | null;
	/** Share that came true, 0–1; null for an empty group. */
	rate: number | null;
}

/** How well the forecasts did, over resolved likes only. */
export interface Calibration {
	resolved: number;
	yes: number;
	pending: number;
	/** yes / resolved; null with nothing resolved. */
	baseRate: number | null;
	meanForecast: number | null;
	/** (mean forecast − base rate) in percentage points; negative means the forecasts run pessimistic. */
	biasPp: number | null;
	/** mean((forecast/100 − outcome)²). */
	brier: number | null;
	/** The Brier score of forecasting the base rate every time: baseRate × (1 − baseRate). */
	referenceBrier: number | null;
	/** Forecast buckets ≤5, 6–15, 16–30, ≥31. */
	buckets: LikeGroup[];
	/** Each split's groups, nulls left out. */
	splits: Array<{ name: string; groups: LikeGroup[] }>;
	/** fitsType true / fitsType known, over every like logged, resolved or not. */
	typeShare: { fits: number; known: number; share: number | null };
}

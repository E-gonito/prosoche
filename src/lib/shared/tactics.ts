/**
 * The tactics trainer's rules: what a scenario is, how an answer is judged
 * and scored, how a mission is graded, and how accuracy per tag moves.
 *
 * Shared because the drill screen judges an answer the moment it is given,
 * and the server judges it again before writing it to the log, and the two
 * must agree. Every number worth tuning is in `TACTICS`, once. Nothing here
 * knows a file format: scenarios are parsed by `server/parse/scenario.ts`,
 * attempts by `server/parse/attempts.ts`. Pure throughout.
 */

export type Game = 'ron' | 'bodycam' | 'shared';
export const GAMES: readonly Game[] = ['ron', 'bodycam', 'shared'];

/**
 * The kinds of drill. The choice drills (`threat-call`, `hold-peek`,
 * `squad-command`) are one mechanic, a lettered option picked against the
 * clock, and differ only in what they ask; `clear-order` is a sequence of
 * angles. `recall` is the brief's free-recall card, which belongs to
 * Flashcards, so a mission never serves one.
 */
export type DrillKind = 'threat-call' | 'hold-peek' | 'squad-command' | 'clear-order' | 'recall';
export const DRILLS: readonly DrillKind[] = ['threat-call', 'hold-peek', 'squad-command', 'clear-order', 'recall'];
export const CHOICE_DRILLS: readonly DrillKind[] = ['threat-call', 'hold-peek', 'squad-command'];

export type Provenance = 'own-aar' | 'official' | 'community' | 'inferred';
export const PROVENANCES: readonly Provenance[] = ['own-aar', 'official', 'community', 'inferred'];

export type Status = 'draft' | 'approved' | 'retired';
export const STATUSES: readonly Status[] = ['draft', 'approved', 'retired'];

/** What a mission draws from. `aar-review` is only scenarios from your own after-action reviews. */
export type Mode = 'ron' | 'bodycam' | 'shared' | 'aar-review';
export const MODES: readonly Mode[] = ['ron', 'bodycam', 'shared', 'aar-review'];

export type Point = [x: number, y: number];
export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export const DIRECTIONS: readonly Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export type EntityType = 'player' | 'teammate' | 'suspect' | 'civilian' | 'enemy';
export const ENTITY_TYPES: readonly EntityType[] = ['player', 'teammate', 'suspect', 'civilian', 'enemy'];

/**
 * A `tactic-map` block, version 1: a top-down room on a grid. Coordinates
 * are grid units with the origin top left, so `N` is up the screen.
 */
export interface TacticMap {
	v: 1;
	grid: Point;
	/** Each `[x1, y1, x2, y2]`. */
	walls: Array<[number, number, number, number]>;
	doors: Array<{ id: string; at: Point }>;
	/** The angles a `clear-order` drill asks you to put in order. */
	angles: Array<{ id: string; from: Point; dir: Direction }>;
	entities: Array<{ type: EntityType; at: Point; state: string }>;
}

export interface Option {
	/** `A`, `B`, … */
	key: string;
	text: string;
}

/** One scenario note, read and checked. */
export interface Scenario {
	id: string;
	/** Vault-relative. */
	path: string;
	game: Game;
	drill: DrillKind;
	/** Dot-namespaced, `cqb.corner`; the first is its primary tag. */
	tags: string[];
	/** 1 to 5. */
	difficulty: number;
	timeLimitS: number;
	provenance: Provenance;
	source: string;
	verifiedVersion: string;
	status: Status;
	created: string;
	/** Markdown, as written. */
	situation: string;
	map: TacticMap | null;
	/** A choice drill's options; empty for `clear-order`. */
	options: Option[];
	/**
	 * Every acceptable answer: for a choice drill one-item lists of option
	 * keys (`[['B']]`), for `clear-order` angle sequences
	 * (`[['A1', 'A3', 'A2']]`).
	 */
	answers: string[][];
	/** Markdown; empty until written. Never shown before the drill is answered. */
	why: string;
	/** The Why is still a draft someone other than you suggested, marked `> [!suggestion]`. */
	whySuggested: boolean;
	/** Option keys that break the rules of engagement. */
	roeViolation: string[];
}

/**
 * A scenario as the browser gets it: the Situation and the Why rendered,
 * the Why without its suggestion marker, which `whySuggested` carries
 * instead. A page shows `whyHtml` only after the drill is answered.
 */
export interface ScenarioView extends Scenario {
	situationHtml: string;
	whyHtml: string;
	/** The Why as markdown to edit: a suggestion comes out of its callout, to keep or reword. */
	whyText: string;
}

/**
 * How an answer went. `late` is right but after the time limit; `timeout`
 * is no answer within `TACTICS.overtime` times the limit.
 */
export type Result = 'in-time' | 'late' | 'wrong' | 'timeout';
export const RESULTS: readonly Result[] = ['in-time', 'late', 'wrong', 'timeout'];

export type Device = 'pc' | 'phone';

/** One line of the attempt log. */
export interface Attempt {
	/** Local time, `YYYY-MM-DDTHH:MM:SS`. */
	at: string;
	scenario: string;
	mission: string;
	/** Option key, or angle ids in order; null on a timeout. */
	answer: string[] | null;
	result: Result;
	correct: boolean;
	ms: number;
	roe: boolean;
	device: Device;
}

/** Every tunable in the trainer. Change a number here and both sides follow. */
export const TACTICS = {
	points: { 'in-time': 100, late: 60, wrong: 0, timeout: 0 } satisfies Record<Result, number>,
	/** A drill stops waiting at this many times its limit; until then a right answer is late, not wrong. */
	overtime: 2,
	/** Lowest mean score for each grade, best first. Below the last is D, as is any ROE violation. */
	grades: [
		['S', 95],
		['A', 85],
		['B', 70],
		['C', 55]
	] as Array<[Grade, number]>,
	/** Weight of the newest answer in a tag's moving accuracy. */
	alpha: 0.3,
	/** A tag's accuracy before its first answer. */
	prior: 0.5,
	noveltyBonus: 0.5,
	dueBonus: 0.3,
	/** Difficulty d + 1 opens on a tag once its last `window` answers at d are at least `accuracy` right. */
	ramp: { accuracy: 0.8, window: 5 },
	/** At most this many drills in a row share a primary tag. */
	maxRun: 2,
	length: { min: 8, max: 12, default: 10 }
};

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** A judged answer: what the log records and what the debrief shows. */
export interface Judged {
	result: Result;
	correct: boolean;
	roe: boolean;
	points: number;
}

/**
 * Judge `answer` (null for none given) to `scenario`, taken `ms` after the
 * options appeared. Right within the limit is in time, right within
 * `overtime` limits is late, and anything slower is a timeout whatever was
 * picked. A choice that is an ROE violation is flagged even when it is late.
 * Pure.
 */
export function judge(scenario: Pick<Scenario, 'answers' | 'roeViolation' | 'timeLimitS'>, answer: string[] | null, ms: number): Judged {
	const limit = scenario.timeLimitS * 1000;
	if (answer === null || ms > limit * TACTICS.overtime) return outcome('timeout', false);
	const roe = answer.length === 1 && scenario.roeViolation.includes(answer[0]);
	const right = scenario.answers.some((a) => a.length === answer.length && a.every((step, i) => step === answer[i]));
	return outcome(right ? (ms <= limit ? 'in-time' : 'late') : 'wrong', roe);
}

function outcome(result: Result, roe: boolean): Judged {
	return { result, correct: result === 'in-time' || result === 'late', roe, points: TACTICS.points[result] };
}

/**
 * A mission's grade from its judged drills: the mean score's band, capped
 * at D by any ROE violation, as Ready or Not grades. An empty mission is a
 * D with a mean of 0. Pure.
 */
export function missionGrade(drills: Array<Pick<Judged, 'points' | 'roe'>>): { grade: Grade; mean: number; violations: number } {
	const violations = drills.filter((d) => d.roe).length;
	const mean = drills.length ? drills.reduce((sum, d) => sum + d.points, 0) / drills.length : 0;
	const band = TACTICS.grades.find(([, floor]) => mean >= floor)?.[0] ?? 'D';
	return { grade: violations > 0 ? 'D' : band, mean, violations };
}

/** A tag's moving accuracy and how many answers it has seen. */
export interface TagStat {
	accuracy: number;
	answers: number;
}

/**
 * Accuracy per tag after `attempts`, oldest first, starting from `from`
 * (no answers yet when omitted). Each answer moves every tag its scenario
 * carries by `TACTICS.alpha` toward 1 if it was right and 0 if not. An
 * attempt at a scenario not in `scenarios` is skipped. Returns a new map;
 * never mutates `from`. Pure.
 */
export function tagAccuracy(
	attempts: ReadonlyArray<Pick<Attempt, 'scenario' | 'correct'>>,
	scenarios: ReadonlyMap<string, Pick<Scenario, 'tags'>>,
	from: Readonly<Record<string, TagStat>> = {}
): Record<string, TagStat> {
	const out: Record<string, TagStat> = { ...from };
	for (const attempt of attempts) {
		for (const tag of scenarios.get(attempt.scenario)?.tags ?? []) {
			const before = out[tag] ?? { accuracy: TACTICS.prior, answers: 0 };
			const x = attempt.correct ? 1 : 0;
			out[tag] = { accuracy: TACTICS.alpha * x + (1 - TACTICS.alpha) * before.accuracy, answers: before.answers + 1 };
		}
	}
	return out;
}

/** A tag's accuracy, the prior when it has none yet. Pure. */
export function accuracyOf(stats: Readonly<Record<string, TagStat>>, tag: string): number {
	return stats[tag]?.accuracy ?? TACTICS.prior;
}

/** The keys that pick the `n`th option or angle: `1`-`9`, and `a`-`i` for options. Pure. */
export function optionIndexForKey(key: string, letters: boolean): number | null {
	const k = key.toLowerCase();
	if (/^[1-9]$/.test(k)) return Number(k) - 1;
	if (letters && /^[a-i]$/.test(k)) return k.charCodeAt(0) - 97;
	return null;
}

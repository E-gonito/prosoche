/**
 * Choosing a mission's drills: weakest tags most, unseen and due scenarios
 * next, harder ones only once the easier ones on a tag are reliably right,
 * and never more than `TACTICS.maxRun` in a row on one primary tag.
 *
 * Everything is worked out from the attempt log on each call; nothing is
 * stored. Due-ness replays a scenario's attempts through the app's one
 * scheduler, `shared/scheduler.ts`, as if each were a flashcard grade, so
 * there is no second scheduler. Pure: the random numbers come in as a
 * function, so a test can seed them.
 */

import { outcomes, type Grade, type Schedule } from '$lib/shared/scheduler';
import { accuracyOf, tagAccuracy, TACTICS, type Attempt, type Result, type Scenario, type TagStat } from '$lib/shared/tactics';

/** A number in [0, 1), like `Math.random`. */
export type Rng = () => number;

/** A small seeded generator (mulberry32), for tests and for a mission that should be repeatable. */
export function seeded(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** How each result grades a scenario for scheduling. */
const AS_GRADE: Record<Result, Grade> = { 'in-time': 'good', late: 'hard', wrong: 'again', timeout: 'again' };

/**
 * The schedule of each scenario that has been answered, by id, from its
 * attempts oldest first, each credited to the day of its timestamp. Pure.
 */
export function schedules(attempts: readonly Attempt[]): Map<string, Schedule> {
	const out = new Map<string, Schedule>();
	for (const a of attempts) {
		out.set(a.scenario, outcomes(out.get(a.scenario) ?? null, a.at.slice(0, 10))[AS_GRADE[a.result]].schedule);
	}
	return out;
}

/**
 * The hardest difficulty open on each tag. A tag starts at the easiest
 * difficulty `pool` has for it, and opens the next one up once its last
 * `TACTICS.ramp.window` answers at the current one are at least
 * `TACTICS.ramp.accuracy` right. Pure.
 */
export function openDifficulty(pool: readonly Scenario[], attempts: readonly Attempt[]): Map<string, number> {
	const byId = new Map(pool.map((s) => [s.id, s]));
	const out = new Map<string, number>();
	const tags = new Set(pool.flatMap((s) => s.tags));
	for (const tag of tags) {
		const levels = [...new Set(pool.filter((s) => s.tags.includes(tag)).map((s) => s.difficulty))].sort((a, b) => a - b);
		let open = levels[0];
		for (const level of levels.slice(1)) {
			const recent = attempts.filter((a) => byId.get(a.scenario)?.tags.includes(tag) && byId.get(a.scenario)?.difficulty === open).slice(-TACTICS.ramp.window);
			const right = recent.filter((a) => a.correct).length;
			if (recent.length < TACTICS.ramp.window || right / recent.length < TACTICS.ramp.accuracy) break;
			open = level;
		}
		out.set(tag, open);
	}
	return out;
}

/** What the sampler weighed a scenario at, for a test or a curious reader. */
export interface Weighed {
	scenario: Scenario;
	weight: number;
	/** Every tag has its difficulty open. */
	open: boolean;
}

/**
 * Each scenario's weight: one minus its weakest tag's accuracy, plus
 * `noveltyBonus` if never answered, plus `dueBonus` if the scheduler has it
 * due on or before `today`. Pure.
 */
export function weigh(pool: readonly Scenario[], attempts: readonly Attempt[], today: string, stats?: Record<string, TagStat>): Weighed[] {
	const tags = stats ?? tagAccuracy(attempts, new Map(pool.map((s) => [s.id, s])));
	const due = schedules(attempts);
	const open = openDifficulty(pool, attempts);
	return pool.map((scenario) => {
		const weakest = Math.min(...scenario.tags.map((t) => accuracyOf(tags, t)), 1);
		const schedule = due.get(scenario.id);
		const weight = 1 - weakest + (schedule ? 0 : TACTICS.noveltyBonus) + (schedule && schedule.due <= today ? TACTICS.dueBonus : 0);
		return { scenario, weight, open: scenario.tags.every((t) => (open.get(t) ?? 1) >= scenario.difficulty) };
	});
}

/**
 * A mission of up to `length` different scenarios from `pool`, in the
 * order to play them.
 *
 * Draws by weight without replacement, from the scenarios whose difficulty
 * is open first and the rest only when those run out, so a short pool still
 * fills a mission. A scenario whose primary tag would make a run longer
 * than `TACTICS.maxRun` is passed over while any other is left; when none
 * is, the run is allowed rather than the mission cut short. Pure, given `rng`.
 */
export function pickMission(pool: readonly Scenario[], attempts: readonly Attempt[], today: string, length: number, rng: Rng): Scenario[] {
	const weighed = weigh(pool, attempts, today);
	const tiers = [weighed.filter((w) => w.open), weighed.filter((w) => !w.open)];
	const out: Scenario[] = [];
	for (const tier of tiers) {
		const left = [...tier];
		while (out.length < length && left.length) {
			const allowed = left.filter((w) => !breaksRun(out, w.scenario));
			const from = allowed.length ? allowed : left;
			const chosen = draw(from, rng);
			out.push(chosen.scenario);
			left.splice(left.indexOf(chosen), 1);
		}
	}
	return out;
}

function breaksRun(sofar: readonly Scenario[], next: Scenario): boolean {
	const tail = sofar.slice(-TACTICS.maxRun);
	return tail.length === TACTICS.maxRun && tail.every((s) => s.tags[0] === next.tags[0]);
}

function draw(from: readonly Weighed[], rng: Rng): Weighed {
	// A floor, so a tag at full accuracy is still drawn sometimes.
	const weights = from.map((w) => Math.max(w.weight, 0.05));
	let r = rng() * weights.reduce((a, b) => a + b, 0);
	for (let i = 0; i < from.length; i++) {
		r -= weights[i];
		if (r < 0) return from[i];
	}
	return from[from.length - 1];
}

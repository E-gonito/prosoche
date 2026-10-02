/**
 * How well calibrated the forecasts on likes sent are. Pure: it takes the
 * records already read and never touches the vault, so every number here is
 * table-tested.
 *
 * Only resolved likes (yes or no) are scored. A pending like has no outcome
 * yet, and counting it as a no would make every forecast look optimistic.
 * In every split, a like whose value for that split is unknown (null) is
 * left out of it rather than counted as false.
 */

import { MIN_GROUP, type Calibration, type Like, type LikeGroup } from '$lib/shared/likes';

/** The forecast buckets, inclusive, in whole percent. */
const BUCKETS: Array<{ name: string; from: number; to: number }> = [
	{ name: '≤5%', from: -Infinity, to: 5 },
	{ name: '6–15%', from: 6, to: 15 },
	{ name: '16–30%', from: 16, to: 30 },
	{ name: '≥31%', from: 31, to: Infinity }
];

/** An age, as the band it is split by; null for an unknown age. */
function ageBand(age: number | null): string | null {
	if (age === null) return null;
	return age < 25 ? '<25' : age <= 26 ? '25–26' : age <= 30 ? '27–30' : '31+';
}

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');

/** Each split: its name, the group a like falls in (null leaves it out), and the groups' order. */
const SPLITS: Array<{ name: string; of: (l: Like) => string | null; order: string[] }> = [
	{ name: 'Out of my league', of: (l) => yesNo(l.outOfLeague), order: ['Yes', 'No'] },
	{ name: 'Fits my type', of: (l) => yesNo(l.fitsType), order: ['Yes', 'No'] },
	{ name: 'Age', of: (l) => ageBand(l.age), order: ['<25', '25–26', '27–30', '31+'] },
	{ name: 'Liked on', of: (l) => l.likedOn, order: ['photo', 'prompt'] },
	{ name: 'Commented', of: (l) => yesNo(l.commented), order: ['Yes', 'No'] }
];

/**
 * The calibration of `likes`: base rate, bias, Brier score against the
 * base rate's own, the bucket table, the splits, and the share of likes that
 * fit the type. Every count is reported, however small; a group under
 * `MIN_GROUP` is marked not `enough`, for the page to say so. The headline
 * numbers are given at any size, with `resolved` beside them.
 *
 * The type share is over every like logged, resolved or not, since it
 * describes who the likes went to rather than how they turned out.
 */
export function calibration(likes: Like[]): Calibration {
	const resolved = likes.filter((l) => l.status !== 'pending');
	const yes = resolved.filter((l) => l.status === 'yes').length;
	const overall = group('All', resolved);
	const baseRate = overall.rate;
	const brier = resolved.length ? mean(resolved.map((l) => (l.forecast / 100 - outcome(l)) ** 2)) : null;
	const known = likes.filter((l) => l.fitsType !== null);
	const fits = known.filter((l) => l.fitsType).length;

	return {
		resolved: resolved.length,
		yes,
		pending: likes.length - resolved.length,
		baseRate,
		meanForecast: overall.meanForecast,
		biasPp: baseRate === null || overall.meanForecast === null ? null : round((overall.meanForecast - baseRate) * 100, 1),
		brier: brier === null ? null : round(brier, 4),
		referenceBrier: baseRate === null ? null : round(baseRate * (1 - baseRate), 4),
		buckets: BUCKETS.map((b) => group(b.name, resolved.filter((l) => l.forecast >= b.from && l.forecast <= b.to))),
		splits: SPLITS.map((s) => ({
			name: s.name,
			groups: s.order.map((name) => group(name, resolved.filter((l) => s.of(l) === name)))
		})),
		typeShare: { fits, known: known.length, share: known.length ? fits / known.length : null }
	};
}

/** One group scored: its size, whether that is enough, its mean forecast and its rate. */
function group(name: string, likes: Like[]): LikeGroup {
	return {
		name,
		n: likes.length,
		enough: likes.length >= MIN_GROUP,
		meanForecast: likes.length ? mean(likes.map((l) => l.forecast / 100)) : null,
		rate: likes.length ? mean(likes.map(outcome)) : null
	};
}

const outcome = (l: Like) => (l.status === 'yes' ? 1 : 0);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Rounded to `places` decimals, so 0.13 reads as 0.13 and not 0.13000000000000003. */
const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

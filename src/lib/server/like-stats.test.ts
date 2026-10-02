import { describe, it, expect } from 'vitest';
import { calibration } from './like-stats';
import type { Like } from '$lib/shared/likes';

/** A like with only what a test cares about; everything else unknown. */
const like = (forecast: number, status: Like['status'], over: Partial<Like> = {}): Like => ({
	id: 'x',
	label: 'x',
	sentDate: '2026-10-01',
	forecast,
	outOfLeague: null,
	fitsType: null,
	age: null,
	likedOn: null,
	commented: null,
	status,
	resolvedDate: null,
	resolvedBy: null,
	notes: '',
	sentDateMigrated: false,
	hash: '',
	...over
});

describe('calibration', () => {
	it('scores {10, no} and {50, yes}: Brier 0.13, base rate 50%, bias −20 pp', () => {
		const c = calibration([like(10, 'no'), like(50, 'yes')]);
		expect(c).toMatchObject({ resolved: 2, yes: 1, baseRate: 0.5, meanForecast: 0.3, biasPp: -20, brier: 0.13, referenceBrier: 0.25 });
	});

	it('leaves pending likes out of every score', () => {
		const c = calibration([like(10, 'no'), like(50, 'yes'), like(90, 'pending')]);
		expect(c).toMatchObject({ resolved: 2, pending: 1, brier: 0.13 });
	});

	it('has nothing to score with nothing resolved', () => {
		expect(calibration([like(10, 'pending')])).toMatchObject({ resolved: 0, baseRate: null, biasPp: null, brier: null, referenceBrier: null });
	});

	it('buckets forecasts at ≤5, 6–15, 16–30 and ≥31, with n always and numbers only from ten', () => {
		const likes = [like(5, 'no'), like(6, 'no'), like(15, 'yes'), like(16, 'no'), like(30, 'no'), like(31, 'yes'), ...Array.from({ length: 10 }, () => like(2, 'no'))];
		const c = calibration(likes);
		expect(c.buckets.map((b) => [b.name, b.n, b.enough])).toEqual([
			['≤5%', 11, true],
			['6–15%', 2, false],
			['16–30%', 2, false],
			['≥31%', 1, false]
		]);
		expect(c.buckets[0]).toMatchObject({ rate: 0 });
		expect(c.buckets[0].meanForecast).toBeCloseTo((5 + 20) / 11 / 100);
	});

	it('leaves unknowns out of a split rather than counting them as no, and bands ages', () => {
		const c = calibration([
			like(10, 'yes', { fitsType: true, age: 24 }),
			like(10, 'no', { fitsType: false, age: 25 }),
			like(10, 'no', { fitsType: null, age: 26 }),
			like(10, 'no', { age: 30 }),
			like(10, 'no', { age: 31 })
		]);
		const split = (name: string) => c.splits.find((s) => s.name === name)!.groups.map((g) => [g.name, g.n]);
		expect(split('Fits my type')).toEqual([['Yes', 1], ['No', 1]]);
		expect(split('Age')).toEqual([['<25', 1], ['25–26', 2], ['27–30', 1], ['31+', 1]]);
		expect(split('Out of my league')).toEqual([['Yes', 0], ['No', 0]]);
	});

	it('gives the share of likes that fit the type over every like where it is known, pending included', () => {
		const c = calibration([like(10, 'pending', { fitsType: true }), like(10, 'no', { fitsType: false }), like(10, 'no', { fitsType: true }), like(10, 'no')]);
		expect(c.typeShare).toEqual({ fits: 2, known: 3, share: 2 / 3 });
	});
});

import { describe, it, expect } from 'vitest';
import { blockMinutes, coveredMinutes, overlappingCount } from './schedule';

const at = (startMin: number, endMin: number) => ({ startMin, endMin });

describe('blockMinutes', () => {
	it('measures a normal block', () => {
		expect(blockMinutes(at(570, 600))).toBe(30);
	});
	it('treats a backwards range as crossing midnight', () => {
		expect(blockMinutes(at(1410, 30))).toBe(60);
	});
	it('is zero for an unscheduled task', () => {
		expect(blockMinutes({ startMin: null, endMin: null })).toBe(0);
	});
});

describe('coveredMinutes', () => {
	it('adds separate blocks', () => {
		expect(coveredMinutes([at(540, 600), at(660, 720)])).toBe(120);
	});

	it('counts a nested block only once', () => {
		// The common case: a 10:40-18:00 work block containing 14:00-14:30 reading.
		expect(coveredMinutes([at(640, 1080), at(840, 870)])).toBe(440);
	});

	it('merges partial overlaps', () => {
		expect(coveredMinutes([at(540, 660), at(600, 720)])).toBe(180);
	});

	it('joins blocks that touch exactly', () => {
		expect(coveredMinutes([at(540, 600), at(600, 660)])).toBe(120);
	});

	it('is zero for nothing scheduled', () => {
		expect(coveredMinutes([])).toBe(0);
		expect(coveredMinutes([{ startMin: null, endMin: null }])).toBe(0);
	});
});

describe('overlappingCount', () => {
	it('spots blocks inside others', () => {
		expect(overlappingCount([at(640, 1080), at(840, 870), at(960, 1080)])).toBe(2);
	});
	it('is zero for a tidy day', () => {
		expect(overlappingCount([at(540, 600), at(600, 660)])).toBe(0);
	});
});

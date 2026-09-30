import { describe, expect, it } from 'vitest';
import { GRADES, fromSm2, outcomes, type Schedule } from './scheduler';

const TODAY = '2026-09-30';

describe('a card answered for the first time', () => {
	const next = outcomes(null, TODAY);

	it('keeps again and hard in learning today, and sends good and easy out for days', () => {
		expect(next.again.schedule).toMatchObject({ due: TODAY, state: 'learning', reps: 1, lapses: 0, last: TODAY });
		expect(next.hard.schedule).toMatchObject({ due: TODAY, state: 'learning' });
		expect(next.good.schedule.state).toBe('review');
		expect(next.good.schedule.due > TODAY).toBe(true);
		expect(next.easy.schedule.due > next.good.schedule.due).toBe(true);
	});

	it('labels the learning step in minutes and the rest in days', () => {
		expect(next.again.label).toBe('10 min');
		expect(next.hard.label).toBe('15 min');
		expect(next.good.label).toMatch(/^\d+ days$/);
		expect(next.easy.label).toMatch(/^\d+ days$/);
	});

	it('rounds the memory state to two decimals', () => {
		for (const g of GRADES) {
			const { stability, difficulty } = next[g].schedule;
			expect(Math.round(stability * 100) / 100).toBe(stability);
			expect(Math.round(difficulty * 100) / 100).toBe(difficulty);
		}
	});
});

describe('a learning card answered good', () => {
	it('graduates to review on a later day', () => {
		const learning = outcomes(null, TODAY).again.schedule;
		const next = outcomes(learning, TODAY).good.schedule;
		expect(next.state).toBe('review');
		expect(next.due > TODAY).toBe(true);
		expect(next.reps).toBe(2);
	});
});

describe('a review card', () => {
	const current: Schedule = { due: TODAY, stability: 10, difficulty: 5, reps: 3, lapses: 0, state: 'review', last: '2026-09-20' };
	const next = outcomes(current, TODAY);

	it('orders the four answers by interval', () => {
		const due = GRADES.map((g) => next[g].schedule.due);
		expect([...due].sort()).toEqual(due);
		expect(new Set(due).size).toBe(4);
	});

	it('relearns on again and counts the lapse', () => {
		expect(next.again.schedule).toMatchObject({ due: TODAY, state: 'relearning', lapses: 1, reps: 4 });
	});

	it('grows stability on good', () => {
		expect(next.good.schedule.stability).toBeGreaterThan(10);
		expect(next.good.schedule.last).toBe(TODAY);
	});

	it('gives the same answer every time, fuzz and all', () => {
		expect(outcomes(current, TODAY)).toEqual(next);
	});

	it('never mutates what it was given', () => {
		const copy = { ...current };
		outcomes(current, TODAY);
		expect(current).toEqual(copy);
	});
});

describe('fromSm2', () => {
	it('reads an SM-2 schedule as a review card', () => {
		expect(fromSm2('2026-10-10', 10, 250)).toEqual({ due: '2026-10-10', stability: 10, difficulty: 5, reps: 1, lapses: 0, state: 'review', last: '2026-09-30' });
	});

	it('maps ease onto difficulty, hardest at the floor', () => {
		expect(fromSm2(TODAY, 3, 130).difficulty).toBe(10);
		expect(fromSm2(TODAY, 3, 370).difficulty).toBe(1);
		expect(fromSm2(TODAY, 3, 500).difficulty).toBe(1);
	});

	it('gives a card lapsed to interval 0 a day of stability', () => {
		expect(fromSm2(TODAY, 0, 230)).toMatchObject({ stability: 1, last: TODAY });
	});

	it('schedules like any other review card', () => {
		const next = outcomes(fromSm2(TODAY, 10, 250), TODAY);
		expect(next.good.schedule.state).toBe('review');
		expect(next.good.schedule.due > TODAY).toBe(true);
	});
});

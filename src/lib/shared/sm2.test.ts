import { describe, expect, it } from 'vitest';
import { GRADES, OSR, addDays, daysBetween, intervalLabel, isDue, schedule, type Grade, type Schedule } from './sm2';

/**
 * The first block is the important one: these four rows are the schedules the
 * Spaced Repetition plugin actually wrote into this vault for a first review,
 * read out of the notes a real deck is built from. If
 * they ever stop matching, the hub and Obsidian have started to disagree.
 */
describe('a card reviewed for the first time', () => {
	const cases: Array<[Grade, number, number]> = [
		// grade, interval, ease
		['again', 0, 230],
		['hard', 1, 230],
		['good', 3, 250],
		['easy', 4, 270]
	];

	for (const [grade, interval, ease] of cases) {
		it(`${grade} gives ${interval} days at ease ${ease}`, () => {
			const next = schedule(null, grade, '2026-09-21');
			expect(next.interval).toBe(interval);
			expect(next.ease).toBe(ease);
			expect(next.due).toBe(addDays('2026-09-21', interval));
		});
	}
});

describe('a card reviewed on time', () => {
	const current: Schedule = { due: '2026-09-21', interval: 10, ease: 250 };

	it('multiplies the interval by the ease on good', () => {
		expect(schedule(current, 'good', '2026-09-21')).toEqual({ due: '2026-10-16', interval: 25, ease: 250 });
	});

	it('adds the easy bonus and raises the ease on easy', () => {
		// (10 * 270 / 100) * 1.3 = 35.1
		expect(schedule(current, 'easy', '2026-09-21')).toEqual({ due: '2026-10-26', interval: 35, ease: 270 });
	});

	it('halves the interval and drops the ease on hard', () => {
		expect(schedule(current, 'hard', '2026-09-21')).toEqual({ due: '2026-09-26', interval: 5, ease: 230 });
	});

	it('brings the card back the same day on again', () => {
		expect(schedule(current, 'again', '2026-09-21')).toEqual({ due: '2026-09-21', interval: 0, ease: 230 });
	});
});

describe('the edges', () => {
	it('credits the days a card sat overdue', () => {
		// Ten days late, good: (10 + 10/2) * 2.5 = 37.5, rounded to 38.
		const late = schedule({ due: '2026-09-11', interval: 10, ease: 250 }, 'good', '2026-09-21');
		expect(late.interval).toBe(38);
	});

	it('gives a card reviewed early exactly the schedule it would have got', () => {
		const onTime = schedule({ due: '2026-09-21', interval: 10, ease: 250 }, 'good', '2026-09-21');
		const early = schedule({ due: '2026-10-01', interval: 10, ease: 250 }, 'good', '2026-09-21');
		expect(early.interval).toBe(onTime.interval);
		expect(early.ease).toBe(onTime.ease);
	});

	it('never lets the ease fall below the floor', () => {
		let card: Schedule = { due: '2026-09-21', interval: 1, ease: 150 };
		for (let i = 0; i < 10; i++) card = schedule(card, 'again', '2026-09-21');
		expect(card.ease).toBe(OSR.minEase);
	});

	it('keeps a lapsed card at an interval of zero, never negative', () => {
		const lapsed = schedule({ due: '2026-09-21', interval: 0, ease: 130 }, 'again', '2026-09-21');
		expect(lapsed.interval).toBe(0);
		expect(lapsed.due).toBe('2026-09-21');
	});

	it('resets a lapsed card to a real interval on the next good answer', () => {
		// Interval 0 is floored to 1 before the multiplier, so the card does not
		// stay stuck on the same day for ever.
		const back = schedule({ due: '2026-09-21', interval: 0, ease: 230 }, 'good', '2026-09-21');
		expect(back.interval).toBe(2);
	});

	it('clamps at the maximum interval', () => {
		const huge = schedule({ due: '2026-09-21', interval: 30_000, ease: 250 }, 'easy', '2026-09-21');
		expect(huge.interval).toBe(OSR.maxInterval);
	});

	it('honours rules the caller passes instead of the plugin defaults', () => {
		const next = schedule(null, 'good', '2026-09-21', { ...OSR, baseEase: 200 });
		expect(next).toEqual({ due: '2026-09-23', interval: 2, ease: 200 });
	});

	it('leaves the schedule it was given untouched', () => {
		const current: Schedule = { due: '2026-09-21', interval: 10, ease: 250 };
		schedule(current, 'easy', '2026-09-21');
		expect(current).toEqual({ due: '2026-09-21', interval: 10, ease: 250 });
	});
});

describe('due dates', () => {
	it('treats a card with no schedule as new and always available', () => {
		expect(isDue(null, '2000-01-01')).toBe(true);
	});

	it('includes a card due today and every overdue card', () => {
		expect(isDue({ due: '2026-09-21', interval: 1, ease: 250 }, '2026-09-21')).toBe(true);
		expect(isDue({ due: '2026-09-01', interval: 1, ease: 250 }, '2026-09-21')).toBe(true);
		expect(isDue({ due: '2026-09-22', interval: 1, ease: 250 }, '2026-09-21')).toBe(false);
	});

	it('counts days across a month, a year and a leap day', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(daysBetween('2026-09-21', '2026-10-01')).toBe(10);
		expect(daysBetween('2026-10-01', '2026-09-21')).toBe(-10);
	});

	it('survives the hour a clock change would shift', () => {
		// The last Sunday in March, where a local-time Date would land 23:00 on
		// the day before and lose a day.
		expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
	});
});

describe('interval labels', () => {
	it('reads as a person would say it', () => {
		expect(intervalLabel(0)).toBe('today');
		expect(intervalLabel(1)).toBe('1 day');
		expect(intervalLabel(9)).toBe('9 days');
		expect(intervalLabel(61)).toBe('2 mo');
		expect(intervalLabel(365)).toBe('1 yr');
		expect(intervalLabel(900)).toBe('2.5 yr');
	});
});

describe('the grade list', () => {
	it('runs from worst to best, so keys 1 to 4 are in order', () => {
		expect(GRADES).toEqual(['again', 'hard', 'good', 'easy']);
	});
});

import { describe, it, expect } from 'vitest';
import { formatDuration, formatElapsed, parseClock, parseDuration, spanMinutes } from './duration';

describe('parseClock', () => {
	const cases: Array<[string, number | null]> = [
		['09:30', 570],
		['9:30', 570],
		['00:00', 0],
		['23:59', 1439],
		[' 10:42 ', 642],
		['24:00', null],
		['10:75', null],
		['10.30', null],
		['half past ten', null],
		['', null]
	];
	for (const [input, expected] of cases) {
		it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
			expect(parseClock(input)).toBe(expected);
		});
	}
});

describe('spanMinutes', () => {
	it('measures a normal range', () => {
		expect(spanMinutes(642, 725)).toBe(83);
	});

	it('treats an end before the start as crossing midnight', () => {
		expect(spanMinutes(1430, 10)).toBe(20);
	});

	it('is zero for an instant', () => {
		expect(spanMinutes(600, 600)).toBe(0);
	});
});

describe('formatDuration', () => {
	const cases: Array<[number, string]> = [
		[83, '1h23m'],
		[120, '2h'],
		[45, '45m'],
		[0, '0m'],
		[1, '1m'],
		[1445, '24h5m'],
		[-5, '0m'],
		[59.6, '1h']
	];
	for (const [input, expected] of cases) {
		it(`writes ${input} as ${expected}`, () => {
			expect(formatDuration(input)).toBe(expected);
		});
	}
});

describe('parseDuration', () => {
	const cases: Array<[string, number | null]> = [
		['1h23m', 83],
		['2h', 120],
		['45m', 45],
		['0m', 0],
		['1h 23m', 83],
		['24h5m', 1445],
		['', null],
		['1:23', null],
		['about an hour', null],
		['h', null]
	];
	for (const [input, expected] of cases) {
		it(`reads ${JSON.stringify(input)} as ${expected}`, () => {
			expect(parseDuration(input)).toBe(expected);
		});
	}

	it('round-trips everything formatDuration writes', () => {
		for (const minutes of [0, 1, 7, 59, 60, 61, 83, 120, 1439, 1445]) {
			expect(parseDuration(formatDuration(minutes))).toBe(minutes);
		}
	});
});

describe('formatElapsed', () => {
	const cases: Array<[number, string]> = [
		[0, '0:00'],
		[7, '0:07'],
		[64, '1:04'],
		[424, '7:04'],
		[3600, '1:00:00'],
		[5025, '1:23:45'],
		[-3, '0:00']
	];
	for (const [input, expected] of cases) {
		it(`writes ${input}s as ${expected}`, () => {
			expect(formatElapsed(input)).toBe(expected);
		});
	}
});

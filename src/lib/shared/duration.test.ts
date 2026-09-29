import { describe, it, expect } from 'vitest';
import { formatDuration, parseDuration } from './duration';

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

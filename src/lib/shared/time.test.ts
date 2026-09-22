import { describe, it, expect } from 'vitest';
import { formatMinutes, relativeDay } from './time';

describe('formatMinutes', () => {
	it('writes minutes since midnight as a clock', () => {
		expect(formatMinutes(0)).toBe('00:00');
		expect(formatMinutes(9 * 60 + 5)).toBe('09:05');
		expect(formatMinutes(23 * 60 + 59)).toBe('23:59');
	});
});

describe('relativeDay', () => {
	const cases: Array<[string, string]> = [
		['2026-09-21', 'today'],
		['2026-09-22', 'today'],
		['2026-09-20', 'yesterday'],
		['2026-09-16', '5 days ago'],
		['2026-09-09', '12 days ago'],
		['2026-09-07', '2 weeks ago'],
		['2026-08-10', '6 weeks ago'],
		['2026-06-01', '2026-06-01']
	];

	for (const [day, expected] of cases) {
		it(`reads ${day} as "${expected}"`, () => {
			expect(relativeDay(day, '2026-09-21')).toBe(expected);
		});
	}

	it('counts calendar days, not elapsed hours, across a month end', () => {
		expect(relativeDay('2026-08-31', '2026-09-01')).toBe('yesterday');
	});
});

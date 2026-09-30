import { describe, it, expect } from 'vitest';
import { addDays, daysBetween, formatMinutes } from './time';

describe('formatMinutes', () => {
	it('writes minutes since midnight as a clock', () => {
		expect(formatMinutes(0)).toBe('00:00');
		expect(formatMinutes(9 * 60 + 5)).toBe('09:05');
		expect(formatMinutes(23 * 60 + 59)).toBe('23:59');
	});
});

describe('day arithmetic', () => {
	it('moves across months, years and leap days', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(daysBetween('2026-09-21', '2026-10-01')).toBe(10);
		expect(daysBetween('2026-10-01', '2026-09-21')).toBe(-10);
	});

	it('does not drift across a daylight-saving change', () => {
		expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
		expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
	});
});

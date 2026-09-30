import { describe, it, expect } from 'vitest';
import {
	dailyNotePath,
	dayOfNote,
	shiftDay,
	isDayKey,
	today
} from './daily';

describe('dailyNotePath', () => {
	it('matches the vault layout', () => {
		expect(dailyNotePath('2026-09-21')).toBe('Journal/2026/09/21.md');
		expect(dailyNotePath('2026-01-05')).toBe('Journal/2026/01/05.md');
	});
});

describe('shiftDay', () => {
	it('crosses month and year boundaries', () => {
		expect(shiftDay('2026-09-21', 1)).toBe('2026-09-22');
		expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
		expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
	});
	it('handles a leap day', () => {
		expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
	});
});

describe('isDayKey', () => {
	it('accepts real days and rejects the rest', () => {
		expect(isDayKey('2026-09-21')).toBe(true);
		expect(isDayKey('2026-02-30')).toBe(false);
		expect(isDayKey('21-09-2026')).toBe(false);
		expect(isDayKey('../../etc/passwd')).toBe(false);
	});
});

describe('today', () => {
	it('uses local calendar date, not UTC', () => {
		expect(today(new Date(2026, 8, 21, 23, 30))).toBe('2026-09-21');
		expect(today(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
	});
});

describe('dayOfNote', () => {
	it('dates a daily note and nothing else', () => {
		expect(dayOfNote('Journal/2026/09/21.md')).toBe('2026-09-21');
		expect(dayOfNote('Journal/Projects/Riverside.md')).toBeNull();
		expect(dayOfNote('Work/Handbook.md')).toBeNull();
	});
});

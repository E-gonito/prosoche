import { describe, it, expect } from 'vitest';
import {
	dailyNotePath,
	dayOfNote,
	shiftDay,
	isDayKey,
	today,
	formatMinutes,
	isDailyNote
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

describe('formatMinutes', () => {
	it('pads to HH:MM', () => {
		expect(formatMinutes(570)).toBe('09:30');
		expect(formatMinutes(0)).toBe('00:00');
		expect(formatMinutes(1080)).toBe('18:00');
	});
});

describe('isDailyNote', () => {
	it('matches only the dated notes, not everything in the journal folder', () => {
		expect(isDailyNote('Journal/2026/09/21.md')).toBe(true);
		// A workspace can keep its notes inside the journal folder. Excluding
		// the whole folder to skip the template copies would empty its board.
		expect(isDailyNote('Journal/Projects/Some Business/Staff.md')).toBe(false);
		expect(isDailyNote('Journal/Journal Template.md')).toBe(false);
		expect(isDailyNote('Journal/2026/09/21-notes.md')).toBe(false);
		expect(isDailyNote('Computer Science/Algorithms.md')).toBe(false);
	});
});

describe('dayOfNote', () => {
	it('dates a daily note and nothing else', () => {
		expect(dayOfNote('Journal/2026/09/21.md')).toBe('2026-09-21');
		expect(dayOfNote('Journal/Projects/Riverside.md')).toBeNull();
		expect(dayOfNote('Work/Handbook.md')).toBeNull();
	});
});

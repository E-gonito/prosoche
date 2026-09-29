import { describe, it, expect } from 'vitest';
import { noteHref, relativeDay } from './links';

describe('noteHref', () => {
	it('encodes each segment and keeps the slashes', () => {
		expect(noteHref('Work Projects/eye2gene/Log.md')).toBe('/notes/Work%20Projects/eye2gene/Log.md');
	});
});

describe('relativeDay', () => {
	it.each([
		['2026-09-29', 'today'],
		['2026-09-28', 'yesterday'],
		['2026-09-30', 'tomorrow'],
		['2026-09-25', '4 days ago'],
		['2026-10-02', 'in 3 days'],
		['2026-09-01', '2026-09-01']
	])('%s reads as %s on 2026-09-29', (day, words) => {
		expect(relativeDay(day, '2026-09-29')).toBe(words);
	});
});

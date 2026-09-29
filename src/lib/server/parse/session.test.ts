import { describe, it, expect } from 'vitest';
import { formatSessionLine, parseSessionLine, parseSessions, type SessionEntry } from './session';

describe('parseSessionLine', () => {
	const cases: Array<[string, ReturnType<typeof parseSessionLine>]> = [
		[
			'- 2026-09-29 45m [[Algorithms]] graph search, finally clicked',
			{
				line: 0,
				day: '2026-09-29',
				minutes: 45,
				topic: 'Algorithms',
				note: 'graph search, finally clicked',
				raw: '- 2026-09-29 45m [[Algorithms]] graph search, finally clicked'
			}
		],
		[
			// `1h30m`.
			'- 2026-09-29 1h30m [[Algorithms]] revised ease',
			{ line: 0, day: '2026-09-29', minutes: 90, topic: 'Algorithms', note: 'revised ease', raw: '- 2026-09-29 1h30m [[Algorithms]] revised ease' }
		],
		[
			// `90m`, the same ninety minutes written the other way.
			'- 2026-09-29 90m [[Algorithms]] revised ease',
			{ line: 0, day: '2026-09-29', minutes: 90, topic: 'Algorithms', note: 'revised ease', raw: '- 2026-09-29 90m [[Algorithms]] revised ease' }
		],
		[
			// `1h`, no minutes part at all.
			'- 2026-09-29 1h [[Algorithms]] revised ease',
			{ line: 0, day: '2026-09-29', minutes: 60, topic: 'Algorithms', note: 'revised ease', raw: '- 2026-09-29 1h [[Algorithms]] revised ease' }
		],
		[
			// No topic: the note follows the duration directly.
			'- 2026-09-29 20m read a chapter',
			{ line: 0, day: '2026-09-29', minutes: 20, topic: null, note: 'read a chapter', raw: '- 2026-09-29 20m read a chapter' }
		],
		[
			// No note at all.
			'- 2026-09-29 20m [[Algorithms]]',
			{ line: 0, day: '2026-09-29', minutes: 20, topic: 'Algorithms', note: '', raw: '- 2026-09-29 20m [[Algorithms]]' }
		],
		[
			// Bare duration, nothing else.
			'- 2026-09-29 20m',
			{ line: 0, day: '2026-09-29', minutes: 20, topic: null, note: '', raw: '- 2026-09-29 20m' }
		],
		// Not a session line at all.
		['## 2026-09', null],
		['- 2026-09-29 not-a-duration [[Algorithms]] note', null],
		['- 2026-09-29', null],
		['Some prose about 2026-09-29 45m', null]
	];

	for (const [raw, expected] of cases) {
		it(`reads ${JSON.stringify(raw)}`, () => {
			expect(parseSessionLine(raw)).toEqual(expected);
		});
	}

	it('carries the line number through', () => {
		expect(parseSessionLine('- 2026-09-29 45m [[Algorithms]] note', 12)?.line).toBe(12);
	});
});

describe('parseSessions', () => {
	it('collects every session line and skips everything else', () => {
		const content = [
			'---',
			'weekly_hours: 6',
			'---',
			'## 2026-09',
			'- 2026-09-01 30m [[Algorithms]] first pass',
			'- 2026-09-02 1h reading',
			'',
			'## 2026-10',
			'- 2026-10-01 15m tidy notes'
		].join('\n');
		const sessions = parseSessions(content);
		expect(sessions).toHaveLength(3);
		expect(sessions.map((s) => s.day)).toEqual(['2026-09-01', '2026-09-02', '2026-10-01']);
		expect(sessions[0].line).toBe(4);
		expect(sessions[2].minutes).toBe(15);
	});

	it('returns nothing for a note with no sessions', () => {
		expect(parseSessions('# Sessions\n\nNothing logged yet.\n')).toEqual([]);
	});
});

describe('formatSessionLine', () => {
	const cases: Array<[SessionEntry, string]> = [
		[
			{ day: '2026-09-29', minutes: 45, topic: 'Algorithms', note: 'graph search, finally clicked' },
			'- 2026-09-29 45m [[Algorithms]] graph search, finally clicked'
		],
		[{ day: '2026-09-29', minutes: 90, topic: 'Algorithms', note: '' }, '- 2026-09-29 1h30m [[Algorithms]]'],
		[{ day: '2026-09-29', minutes: 20, topic: null, note: 'read a chapter' }, '- 2026-09-29 20m read a chapter'],
		[{ day: '2026-09-29', minutes: 60, topic: null, note: '' }, '- 2026-09-29 1h']
	];

	for (const [entry, expected] of cases) {
		it(`writes ${JSON.stringify(entry)}`, () => {
			expect(formatSessionLine(entry)).toBe(expected);
		});
	}

	it('round-trips through parseSessionLine', () => {
		const entry: SessionEntry = { day: '2026-09-29', minutes: 90, topic: 'Algorithms', note: 'revised ease' };
		const line = formatSessionLine(entry);
		expect(parseSessionLine(line)).toMatchObject(entry);
	});
});

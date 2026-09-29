import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { parseSessions } from '../parse/session';
import { logSession, minutesByTopic, minutesInWeek, minutesThisWeek, readSessions, streak, weekStart, weeklyMinutes } from './sessions';
import type { Session } from '../parse/session';

const make = (day: string, minutes: number, topic: string | null = 'Algorithms'): Session => ({
	line: 0,
	day,
	minutes,
	topic,
	note: '',
	raw: ''
});

describe('weekStart', () => {
	it('is the Monday of the week a date falls in', () => {
		// 2026-09-29 is a Tuesday.
		expect(weekStart('2026-09-29')).toBe('2026-09-28');
	});

	it('is the date itself when it is already a Monday', () => {
		expect(weekStart('2026-09-28')).toBe('2026-09-28');
	});

	it('crosses a month boundary correctly', () => {
		// 2026-10-01 is a Thursday, so its Monday is in September.
		expect(weekStart('2026-10-01')).toBe('2026-09-28');
	});
});

describe('minutesInWeek and minutesThisWeek', () => {
	const sessions = [make('2026-09-20', 30), make('2026-09-28', 45), make('2026-09-29', 60)];

	it('sums only the seven days starting the given day', () => {
		expect(minutesInWeek(sessions, '2026-09-28')).toBe(105);
	});

	it('sums the calendar week today sits in', () => {
		expect(minutesThisWeek(sessions, '2026-09-29')).toBe(105);
	});

	it('is zero for a week with nothing logged', () => {
		expect(minutesThisWeek(sessions, '2026-08-01')).toBe(0);
	});
});

describe('streak', () => {
	it('counts consecutive days ending today', () => {
		const sessions = [make('2026-09-27', 10), make('2026-09-28', 10), make('2026-09-29', 10)];
		expect(streak(sessions, '2026-09-29')).toBe(3);
	});

	it('does not break the streak for an unfinished today', () => {
		const sessions = [make('2026-09-27', 10), make('2026-09-28', 10)];
		expect(streak(sessions, '2026-09-29')).toBe(2);
	});

	it('stops at the first missing day looking back', () => {
		const sessions = [make('2026-09-20', 10), make('2026-09-28', 10), make('2026-09-29', 10)];
		expect(streak(sessions, '2026-09-29')).toBe(2);
	});

	it('is zero when nothing has ever been logged', () => {
		expect(streak([], '2026-09-29')).toBe(0);
	});

	it('counts two sessions on the same day once', () => {
		const sessions = [make('2026-09-29', 10), make('2026-09-29', 20)];
		expect(streak(sessions, '2026-09-29')).toBe(1);
	});
});

describe('minutesByTopic', () => {
	it('sums minutes per topic within the given month, most first', () => {
		const sessions = [make('2026-09-01', 30, 'Algorithms'), make('2026-09-02', 90, 'Networking'), make('2026-09-03', 15, 'Algorithms')];
		expect(minutesByTopic(sessions, '2026-09-15')).toEqual([
			{ topic: 'Networking', minutes: 90 },
			{ topic: 'Algorithms', minutes: 45 }
		]);
	});

	it('groups a topic-less session under Untracked', () => {
		expect(minutesByTopic([make('2026-09-01', 30, null)], '2026-09-15')).toEqual([{ topic: 'Untracked', minutes: 30 }]);
	});

	it('excludes a different month entirely', () => {
		expect(minutesByTopic([make('2026-08-01', 30)], '2026-09-15')).toEqual([]);
	});
});

describe('weeklyMinutes', () => {
	it('buckets sessions into the right week, oldest first', () => {
		const sessions = [make('2026-09-14', 60), make('2026-09-29', 45)];
		const weeks = weeklyMinutes(sessions, '2026-09-29', 4);
		expect(weeks.map((w) => w.start)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
		expect(weeks.map((w) => w.minutes)).toEqual([0, 60, 0, 45]);
	});

	it('never lets minutes leak into a neighbouring week', () => {
		// The Sunday just before the week starting 2026-09-28.
		const weeks = weeklyMinutes([make('2026-09-27', 30)], '2026-09-29', 2);
		expect(weeks.map((w) => w.minutes)).toEqual([30, 0]);
	});
});

describe('reading and writing the vault', () => {
	let root: string;
	let vault: Vault;
	const PATH = 'Study/Sessions.md';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-sessions-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('creates the note and its month heading on the first session', async () => {
		const result = await logSession(vault, PATH, { day: '2026-09-29', minutes: 45, topic: 'Algorithms', note: 'first' });
		expect(result.ok).toBe(true);
		expect((await vault.read(PATH)).content).toBe('## 2026-09\n- 2026-09-29 45m [[Algorithms]] first\n');
	});

	it('files a session under its own month, leaving other months alone', async () => {
		await vault.write(PATH, '## 2026-08\n- 2026-08-05 30m older\n');
		await logSession(vault, PATH, { day: '2026-09-29', minutes: 45, topic: null, note: 'newer' });
		expect((await vault.read(PATH)).content).toBe('## 2026-08\n- 2026-08-05 30m older\n\n## 2026-09\n- 2026-09-29 45m newer\n');
	});

	it('appends a second session after the first, in the same month', async () => {
		await vault.write(PATH, '## 2026-09\n- 2026-09-01 30m one\n');
		await logSession(vault, PATH, { day: '2026-09-29', minutes: 45, topic: null, note: 'two' });
		expect((await vault.read(PATH)).content).toBe('## 2026-09\n- 2026-09-01 30m one\n- 2026-09-29 45m two\n');
	});

	it('reads back what it wrote', async () => {
		await logSession(vault, PATH, { day: '2026-09-29', minutes: 45, topic: 'Algorithms', note: 'note' });
		expect(await readSessions(vault, PATH)).toEqual(parseSessions((await vault.read(PATH)).content));
	});

	it('is an empty list for a note that does not exist', async () => {
		expect(await readSessions(vault, PATH)).toEqual([]);
	});
});

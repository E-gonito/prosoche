import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, hashContent } from './vault/index';
import {
	LEDGER_PATH,
	PEOPLE_FOLDER,
	addDatingDate,
	addDatingPerson,
	bestDayOfWeek,
	gatherInsightsSource,
	likeOdds,
	loadDatingPerson,
	loadDay,
	loadLedger,
	listDatingPeople,
	rangeStats,
	saveDay,
	setStage,
	weeklyTrend
} from './dating';

let root: string;
let vault: Vault;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-dating-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('privacy: nothing under Private/Dating is visible without private scope', () => {
	it('a public read of the ledger sees a missing file', async () => {
		await saveDay(vault, '2026-09-29', { sent: 1, matches: 0, type: 0, received: 0 }, '', hashContent(''));
		const publicRead = await vault.read(LEDGER_PATH);
		expect(publicRead.exists).toBe(false);
		expect(publicRead.content).toBe('');
	});

	it('a public read of a person note sees a missing file', async () => {
		await addDatingPerson(vault, { name: 'Ada', app: 'Hinge' });
		const publicRead = await vault.read(`${PEOPLE_FOLDER}/Ada.md`);
		expect(publicRead.exists).toBe(false);
	});

	it('a public list of the vault includes nothing under Private/Dating', async () => {
		await saveDay(vault, '2026-09-29', { sent: 1, matches: 0, type: 0, received: 0 }, '', hashContent(''));
		await addDatingPerson(vault, { name: 'Ada' });
		const paths = await vault.list();
		expect(paths.some((p) => p.startsWith('Private/'))).toBe(false);
	});

	it('a private-scope read of an ordinary public path also sees nothing, symmetrically', async () => {
		await vault.write('Notes/Hello.md', 'hi');
		const privateRead = await vault.read('Notes/Hello.md', { scope: 'private' });
		expect(privateRead.exists).toBe(false);
	});
});

describe('Log: loadDay and saveDay', () => {
	it('reads a day with no line as all zero, not missing', async () => {
		const day = await loadDay(vault, '2026-09-29');
		expect(day).toMatchObject({ sent: 0, matches: 0, type: 0, received: 0, notes: '' });
	});

	it('creates the ledger and writes the exact artifact line', async () => {
		const zero = await loadDay(vault, '2026-09-29');
		const result = await saveDay(
			vault,
			'2026-09-29',
			{ sent: 12, matches: 2, type: 1, received: 5 },
			'slow Monday',
			zero.hash
		);
		expect(result.ok).toBe(true);

		const note = await vault.read(LEDGER_PATH, { scope: 'private' });
		expect(note.content).toBe('# Ledger\n\n- 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday\n');
	});

	it('loads back what it saved when stepping to a logged day', async () => {
		const zero = await loadDay(vault, '2026-09-20');
		await saveDay(vault, '2026-09-20', { sent: 4, matches: 1, type: 1, received: 0 }, 'met at a bar', zero.hash);
		const loaded = await loadDay(vault, '2026-09-20');
		expect(loaded).toMatchObject({ sent: 4, matches: 1, type: 1, received: 0, notes: 'met at a bar' });
	});

	it('re-saving a day changes only that day, not the rest of the file', async () => {
		const first = await loadDay(vault, '2026-09-01');
		await saveDay(vault, '2026-09-01', { sent: 3, matches: 1, type: 0, received: 0 }, '', first.hash);
		const afterFirst = await loadDay(vault, '2026-09-02');
		await saveDay(vault, '2026-09-02', { sent: 5, matches: 0, type: 0, received: 2 }, '', afterFirst.hash);

		const beforeResave = await loadDay(vault, '2026-09-01');
		await saveDay(vault, '2026-09-01', { sent: 9, matches: 1, type: 0, received: 0 }, '', beforeResave.hash);

		const day1 = await loadDay(vault, '2026-09-01');
		const day2 = await loadDay(vault, '2026-09-02');
		expect(day1.sent).toBe(9);
		expect(day2).toMatchObject({ sent: 5, matches: 0, type: 0, received: 2 });
	});

	it('refuses a save whose expected hash is stale', async () => {
		const zero = await loadDay(vault, '2026-09-29');
		await saveDay(vault, '2026-09-29', { sent: 1, matches: 0, type: 0, received: 0 }, '', zero.hash);
		// zero.hash is now stale; saving again with it must be refused.
		const result = await saveDay(vault, '2026-09-29', { sent: 2, matches: 0, type: 0, received: 0 }, '', zero.hash);
		expect(result).toEqual({ ok: false, reason: 'conflict' });
	});
});

describe('Stats: rangeStats, weeklyTrend, bestDayOfWeek', () => {
	it('computes match rate and type rate as defined: from your own likes', async () => {
		const { entries } = await stageLedger(vault, [
			{ day: '2026-09-28', sent: 10, matches: 5, type: 2, received: 3 },
			{ day: '2026-09-29', sent: 10, matches: 5, type: 3, received: 1 }
		]);
		const stats = rangeStats(entries, '7d', '2026-09-29');
		expect(stats.totals).toEqual({ sent: 20, matches: 10, type: 5, received: 4 });
		expect(stats.matchRate).toBe(0.5);
		expect(stats.typeRate).toBe(0.5);
		expect(stats.days).toBe(7);
		expect(stats.receivedPerDay).toBeCloseTo(4 / 7);
	});

	it('reads an empty range as null rates, not zero or NaN', () => {
		expect(rangeStats([], '7d', '2026-09-29').matchRate).toBeNull();
		expect(rangeStats([], '7d', '2026-09-29').typeRate).toBeNull();
	});

	it('buckets a weekly trend into 7-day blocks ending on the given day', async () => {
		const { entries } = await stageLedger(vault, [
			{ day: '2026-09-15', sent: 4, matches: 1, type: 0, received: 0 },
			{ day: '2026-09-29', sent: 6, matches: 2, type: 0, received: 0 }
		]);
		const trend = weeklyTrend(entries, 3, '2026-09-29');
		expect(trend).toHaveLength(3);
		expect(trend.at(-1)).toMatchObject({ weekEnd: '2026-09-29', sent: 6, matches: 2 });
		expect(trend.at(-3)).toMatchObject({ weekEnd: '2026-09-15', sent: 4, matches: 1 });
	});

	it('finds the weekday with the most matches', async () => {
		// 2026-09-28 is a Monday.
		const { entries } = await stageLedger(vault, [
			{ day: '2026-09-28', sent: 5, matches: 4, type: 0, received: 0 },
			{ day: '2026-09-29', sent: 5, matches: 1, type: 0, received: 0 }
		]);
		expect(bestDayOfWeek(entries)).toEqual({ weekday: 'Monday', matches: 4 });
	});

	it('has no best day when nothing is logged', () => {
		expect(bestDayOfWeek([])).toBeNull();
	});
});

describe('People', () => {
	it('creates a person in the shared person format under Private/Dating/People', async () => {
		const result = await addDatingPerson(vault, { name: 'Ada Lovelace', app: 'Hinge', stage: 'talking' });
		expect(result).toMatchObject({ ok: true, path: `${PEOPLE_FOLDER}/Ada Lovelace.md` });

		const note = await vault.read(result.ok ? result.path : '', { scope: 'private' });
		expect(note.content).toContain('type: person');
		expect(note.content).toContain('app: Hinge');
		expect(note.content).toContain('stage: talking');
	});

	it('logs a like sent as a person at stage liked, with the day and the chance', async () => {
		const result = await addDatingPerson(vault, { name: 'Ada', stage: 'liked', liked: '2026-09-30', chance: 62.4 });
		const note = await vault.read(result.ok ? result.path : '', { scope: 'private' });
		expect(note.content).toBe(
			'---\ntype: person\napp: \nage: \nplace: \njob: \nstage: liked\nliked: 2026-09-30\nchance: 62\n---\n\n# Ada\n'
		);

		const person = await loadDatingPerson(vault, 'Ada');
		expect(person).toMatchObject({ stage: 'liked', liked: '2026-09-30', chance: 62 });
	});

	it('writes no liked or chance line for a person added by hand, and starts them at matched', async () => {
		await addDatingPerson(vault, { name: 'Ada' });
		const person = await loadDatingPerson(vault, 'Ada');
		expect(person).toMatchObject({ stage: 'matched', liked: null, chance: null });
		const note = await vault.read(person.path, { scope: 'private' });
		expect(note.content).not.toMatch(/liked:|chance:/);
	});

	it('refuses to create a person who already has a note', async () => {
		await addDatingPerson(vault, { name: 'Ada' });
		const second = await addDatingPerson(vault, { name: 'Ada' });
		expect(second).toEqual({ ok: false, reason: 'exists' });
	});

	it('groups by stage through listDatingPeople', async () => {
		await addDatingPerson(vault, { name: 'Ada', stage: 'talking' });
		await addDatingPerson(vault, { name: 'Grace', stage: 'dating' });
		const people = await listDatingPeople(vault);
		expect(people.map((p) => [p.name, p.stage])).toEqual([
			['Ada', 'talking'],
			['Grace', 'dating']
		]);
	});

	it('appends a date to a person, creating their note if they have none', async () => {
		const result = await addDatingDate(vault, 'Ada', { day: '2026-09-20', text: 'Coffee at Monmouth', rating: 4, cost: 9 });
		expect(result.ok).toBe(true);

		const person = await loadDatingPerson(vault, 'Ada');
		expect(person.dates).toHaveLength(1);
		expect(person.dates[0]).toMatchObject({ day: '2026-09-20', text: 'Coffee at Monmouth', rating: 4, cost: 9 });
	});

	it('rewrites only the stage line, leaving the rest of the note untouched', async () => {
		await addDatingPerson(vault, { name: 'Ada', app: 'Hinge', stage: 'talking', notes: 'Met through a mutual friend.' });
		const before = await loadDatingPerson(vault, 'Ada');

		const result = await setStage(vault, 'Ada', 'dating');
		expect(result.ok).toBe(true);

		const after = await loadDatingPerson(vault, 'Ada');
		expect(after.stage).toBe('dating');
		expect(after.app).toBe(before.app);
		expect(after.body).toBe(before.body);
	});

	it('refuses to set a stage on a person with no note', async () => {
		const result = await setStage(vault, 'Nobody', 'dating');
		expect(result).toEqual({ ok: false, reason: 'no-note' });
	});
});

describe('likeOdds', () => {
	it('has nothing to say when no like carries a chance', () => {
		expect(likeOdds([{ stage: 'talking', chance: null }])).toBeNull();
	});

	it('sets the guesses against who moved past liked', () => {
		expect(
			likeOdds([
				{ stage: 'liked', chance: 20 },
				{ stage: 'matched', chance: 60 },
				{ stage: 'ended', chance: 70 },
				{ stage: 'dating', chance: null }
			])
		).toEqual({ rated: 3, meanChance: 0.5, expected: 1.5, replied: 2, waiting: 1 });
	});
});

describe('gatherInsightsSource', () => {
	it('carries only ledger and dates-log data, nothing else', async () => {
		await stageLedger(vault, [{ day: '2026-09-29', sent: 3, matches: 1, type: 1, received: 0 }]);
		await addDatingPerson(vault, { name: 'Ada', stage: 'talking' });
		await addDatingDate(vault, 'Ada', { text: 'Coffee', rating: 4 });

		const source = await gatherInsightsSource(vault);
		expect(source.ledger).toEqual([{ day: '2026-09-29', counts: { sent: 3, matches: 1, type: 1, received: 0 }, notes: '' }]);
		expect(source.people).toEqual([{ name: 'Ada', stage: 'talking', dates: expect.any(Array) }]);
		expect(source.people[0].dates[0]).toMatchObject({ text: 'Coffee', rating: 4 });
	});
});

/** Write several days into the ledger directly, then read it back through loadLedger. */
async function stageLedger(
	v: Vault,
	days: Array<{ day: string; sent: number; matches: number; type: number; received: number }>
) {
	for (const d of days) {
		const current = await loadDay(v, d.day);
		await saveDay(v, d.day, { sent: d.sent, matches: d.matches, type: d.type, received: d.received }, '', current.hash);
	}
	return loadLedger(v);
}

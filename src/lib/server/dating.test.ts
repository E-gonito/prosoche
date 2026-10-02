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
	addLike,
	exportLikes,
	importLikes,
	loadLikes,
	loadTypeNote,
	saveTypeNote,
	updateLike,
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
	it('computes the match rate as defined: from your own likes', async () => {
		const { entries } = await stageLedger(vault, [
			{ day: '2026-09-28', sent: 10, matches: 5, type: 2, received: 3 },
			{ day: '2026-09-29', sent: 10, matches: 5, type: 3, received: 1 }
		]);
		const stats = rangeStats(entries, '7d', '2026-09-29');
		expect(stats.totals).toEqual({ sent: 20, matches: 10, type: 5, received: 4 });
		expect(stats.matchRate).toBe(0.5);
		expect(stats.days).toBe(7);
		expect(stats.receivedPerDay).toBeCloseTo(4 / 7);
	});

	it('reads an empty range as null rates, not zero or NaN', () => {
		expect(rangeStats([], '7d', '2026-09-29').matchRate).toBeNull();
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

/** A like exactly as the app wrote one before the record grew: stage, day and chance, nothing else. */
const oldLike = (day: string, chance: number) =>
	`---\ntype: person\napp: \nage: \nplace: \njob: \nstage: liked\nliked: ${day}\nchance: ${chance}\n---\n\n# Someone\n`;
const read = async (name: string) => (await vault.read(`${PEOPLE_FOLDER}/${name}.md`, { scope: 'private' })).content;

describe('likes', () => {
	const TODAY = '2026-10-02';

	it('migrates every existing like: pending, forecasts kept, a 0 clamped to 2, and nothing else in the note changes', async () => {
		const live: Array<[string, string, number]> = [
			['A', '2026-09-30', 5], ['B', '2026-09-30', 10], ['C', '2026-09-30', 35], ['D', '2026-10-01', 25],
			['E', '2026-10-02', 0], ['F', '2026-10-02', 10], ['G', '2026-09-30', 15]
		];
		for (const [name, day, chance] of live) await vault.write(`${PEOPLE_FOLDER}/${name}.md`, oldLike(day, chance), undefined, { scope: 'private' });
		await addDatingPerson(vault, { name: 'Hand', stage: 'matched' });

		const likes = await loadLikes(vault, TODAY);
		expect(likes.map((l) => [l.label, l.sentDate, l.forecast, l.status])).toEqual(
			[...live].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([n, d, c]) => [n, d, c === 0 ? 2 : c, 'pending'])
		);
		for (const [name, day, chance] of live) {
			const expected = oldLike(day, chance === 0 ? 2 : chance).replace('---\n\n#', 'status: pending\n---\n\n#');
			expect(await read(name)).toBe(expected);
		}
		// A person with no forecast is not a like, and her note is left alone.
		expect(likes.some((l) => l.label === 'Hand')).toBe(false);
		// Settling twice writes nothing more.
		const before = await read('A');
		await loadLikes(vault, TODAY);
		expect(await read('A')).toBe(before);
	});

	it('supplies a missing day from the note, marked migrated', async () => {
		await vault.write(`${PEOPLE_FOLDER}/Undated.md`, '---\ntype: person\nstage: liked\nchance: 20\n---\n', undefined, { scope: 'private' });
		const [like] = await loadLikes(vault, TODAY);
		expect(like).toMatchObject({ forecast: 20, sentDateMigrated: true, status: 'pending' });
		expect(await read('Undated')).toMatch(/liked: "?\d{4}-\d{2}-\d{2}"?\n(status: pending\n)?liked_migrated: true\n/);
	});

	it.each<[string, number, string]>([
		['pending for N days stays pending', 7, 'pending'],
		['pending for N+1 days becomes no, by auto', 8, 'no']
	])('%s', async (_name, daysAgo, status) => {
		const sent = new Date(Date.UTC(2026, 9, 2 - daysAgo)).toISOString().slice(0, 10);
		await vault.write(`${PEOPLE_FOLDER}/Old.md`, oldLike(sent, 10), undefined, { scope: 'private' });
		const [like] = await loadLikes(vault, TODAY);
		expect(like.status).toBe(status);
		if (status === 'no') expect(like).toMatchObject({ resolvedBy: 'auto', resolvedDate: TODAY });
	});

	it('clamps a forecast of 0 to 2 and of 100 to 98 when logging a like', async () => {
		const low = await addLike(vault, { label: 'Low', forecast: 0 }, TODAY);
		const high = await addLike(vault, { label: 'High', forecast: 100 }, TODAY);
		expect(low.ok && low.like.forecast).toBe(2);
		expect(high.ok && high.like.forecast).toBe(98);
		expect(await read('Low')).toContain('chance: 2\n');
		expect(await read('High')).toContain('chance: 98\n');
	});

	it('logs a like with its tags, unknown ones left out, and refuses a taken nickname', async () => {
		const added = await addLike(vault, { label: 'Ivy', forecast: 15, sentDate: '2026-10-01', fitsType: true, age: 27, likedOn: 'prompt', commented: null }, TODAY);
		expect(added.ok && added.like).toMatchObject({ sentDate: '2026-10-01', fitsType: true, outOfLeague: null, age: 27, likedOn: 'prompt', commented: null, status: 'pending' });
		const note = await read('Ivy');
		expect(note).toContain('stage: liked\n');
		expect(note).not.toMatch(/commented|out_of_league/);
		expect(await addLike(vault, { label: 'ivy', forecast: 10 }, TODAY)).toMatchObject({ ok: true });
		expect(await addLike(vault, { label: 'Ivy', forecast: 10 }, TODAY)).toEqual({ ok: false, reason: 'exists' });
	});

	it('resolves by hand, moving her stage to talking on a yes, and survives a reload', async () => {
		const added = await addLike(vault, { label: 'Jo', forecast: 30 }, TODAY);
		if (!added.ok) throw new Error('not added');
		const yes = await updateLike(vault, 'Jo', { status: 'yes' }, added.like.hash, TODAY);
		expect(yes.ok && yes.like).toMatchObject({ status: 'yes', resolvedBy: 'manual', resolvedDate: TODAY });
		expect(await read('Jo')).toContain('stage: talking\n');

		// A stale hash writes nothing.
		expect(await updateLike(vault, 'Jo', { status: 'no' }, added.like.hash, TODAY)).toEqual({ ok: false, reason: 'conflict' });

		// A fresh Vault over the same folder is a reload: everything is still there.
		const again = new Vault(root);
		const [like] = await loadLikes(again, TODAY);
		await again.close();
		expect(like).toMatchObject({ label: 'Jo', forecast: 30, status: 'yes', resolvedBy: 'manual' });
	});

	it('resolves a pending like to yes when her stage moves to one that means she replied, and not for matched', async () => {
		await addLike(vault, { label: 'Kit', forecast: 10 }, TODAY);
		await setStage(vault, 'Kit', 'matched', TODAY);
		expect((await loadLikes(vault, TODAY))[0].status).toBe('pending');
		await setStage(vault, 'Kit', 'talking', TODAY);
		expect((await loadLikes(vault, TODAY))[0]).toMatchObject({ status: 'yes', resolvedBy: 'manual' });
	});

	it('exports every record and imports it back, and takes the old shape too, never deleting', async () => {
		await addLike(vault, { label: 'Lou', forecast: 40, fitsType: false }, TODAY);
		const exported = await exportLikes(vault, TODAY);
		expect(exported).toMatchObject({ format: 'prosoche-likes', outcome: 'she replies after matching' });
		expect(Object.keys(exported.records[0]).sort()).toEqual(
			['age', 'commented', 'fitsType', 'forecast', 'id', 'label', 'likedOn', 'notes', 'outOfLeague', 'resolvedBy', 'resolvedDate', 'sentDate', 'sentDateMigrated', 'status'].sort()
		);
		expect(await importLikes(vault, exported, TODAY)).toMatchObject({ created: 0, updated: 0, unchanged: 1 });

		const old = [
			{ name: 'Mo', liked: '2026-10-01', chance: 0, stage: 'liked' },
			{ name: 'Lou', chance: 40, out_of_league: true },
			{ name: 'Nameless' },
			{ name: 'Ned', liked: '2026-09-29', chance: 60, stage: 'dating' }
		];
		const report = await importLikes(vault, old, TODAY);
		expect(report).toMatchObject({ created: 2, updated: 1, unchanged: 0 });
		expect(report.ok && report.problems).toHaveLength(1);

		const byName = Object.fromEntries((await loadLikes(vault, TODAY)).map((l) => [l.label, l]));
		expect(byName.Mo).toMatchObject({ forecast: 2, status: 'pending', sentDate: '2026-10-01' });
		expect(byName.Ned).toMatchObject({ forecast: 60, status: 'yes' });
		// Lou keeps what the import did not say (fitsType) and gains what it did.
		expect(byName.Lou).toMatchObject({ fitsType: false, outOfLeague: true, forecast: 40 });
	});

	it('reads and saves the type note whole, refusing a stale save', async () => {
		const empty = await loadTypeNote(vault);
		expect(empty).toMatchObject({ exists: false, html: '' });
		expect(await saveTypeNote(vault, '# My type\n\n- Wanting children\n', empty.hash)).toEqual({ ok: true });
		const saved = await loadTypeNote(vault);
		expect(saved.html).toContain('Wanting children');
		expect(await saveTypeNote(vault, 'other', empty.hash)).toEqual({ ok: false, reason: 'conflict' });
		expect((await vault.read('Private/Dating/Type.md')).exists).toBe(false);
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

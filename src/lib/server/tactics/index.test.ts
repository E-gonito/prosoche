import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { addStarters, loadAttempts, loadLibrary, missionPool, overview, planMission, recordMission, setStatus, STARTER_PATHS } from './index';
import { seeded } from './sampler';

let dir: string;
let vault: Vault;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'tactics-'));
	vault = new Vault(dir);
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const drill = (scenario: string, answer: string[] | null, ms = 1000, at = '2026-10-20T21:00:00') => ({ scenario, answer, ms, at });

describe('the starters', () => {
	it('all read, all as inferred drafts with a suggested Why', async () => {
		await addStarters(vault);
		const { scenarios, problems } = await loadLibrary(vault);
		expect(problems).toEqual([]);
		expect(scenarios.length).toBeGreaterThan(0);
		expect(scenarios.length).toBeLessThanOrEqual(10);
		for (const s of scenarios) {
			expect(s).toMatchObject({ game: 'shared', provenance: 'inferred', status: 'draft', whySuggested: true });
		}
		expect(STARTER_PATHS).toContain('Tactics/To verify in game.md');
	});

	it('never overwrites one that is already there', async () => {
		await vault.write('Tactics/Scenarios/cqb-0001.md', 'mine');
		const { written } = await addStarters(vault);
		expect(written).not.toContain('Tactics/Scenarios/cqb-0001.md');
		expect((await vault.read('Tactics/Scenarios/cqb-0001.md')).content).toBe('mine');
		expect((await addStarters(vault)).written).toEqual([]);
	});

	it('are a mission only once drafts are allowed', async () => {
		await addStarters(vault);
		const { scenarios } = await loadLibrary(vault);
		expect(missionPool(scenarios, 'ron', false)).toEqual([]);
		const plan = await planMission(vault, { mode: 'bodycam', length: 10, drafts: true }, '2026-10-20', seeded(3));
		expect(plan.drills.length).toBe(scenarios.length);
		expect((await planMission(vault, { mode: 'aar-review', length: 10, drafts: true }, '2026-10-20')).drills).toEqual([]);
	});
});

describe('recordMission', () => {
	beforeEach(async () => {
		await addStarters(vault);
	});

	it('judges each answer itself and appends one line per drill', async () => {
		const result = await recordMission(vault, {
			mission: 'm-20261020-2100',
			device: 'pc',
			drills: [drill('cqb-0002', ['B']), drill('cqb-0003', ['A']), drill('cqb-0001', ['A1', 'A2', 'A3'], 9000), drill('cqb-0004', null, 9000)]
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.attempts.map((a) => a.result)).toEqual(['in-time', 'wrong', 'late', 'timeout']);

		const log = await vault.read('Tactics/Attempts/2026-10.md');
		expect(log.content.startsWith('# Tactics attempts, 2026-10\n\n')).toBe(true);
		expect(await loadAttempts(vault)).toHaveLength(4);

		await recordMission(vault, { mission: 'm-20261020-2110', drills: [drill('cqb-0005', ['B'], 1000, '2026-10-20T21:10:00')] });
		const after = await vault.read('Tactics/Attempts/2026-10.md');
		expect(after.content.startsWith(log.content)).toBe(true);
		expect(await loadAttempts(vault)).toHaveLength(5);
	});

	it('files a mission across midnight at the end of a month in both months', async () => {
		await recordMission(vault, { mission: 'm-x', drills: [drill('cqb-0002', ['B'], 1000, '2026-10-31T23:59:59'), drill('cqb-0003', ['B'], 1000, '2026-11-01T00:00:05')] });
		expect((await vault.read('Tactics/Attempts/2026-10.md')).exists).toBe(true);
		expect((await vault.read('Tactics/Attempts/2026-11.md')).exists).toBe(true);
	});

	it.each([
		['no mission id', { drills: [drill('cqb-0002', ['B'])] }, 'invalid'],
		['no drills', { mission: 'm-x', drills: [] }, 'invalid'],
		['a bad timestamp', { mission: 'm-x', drills: [drill('cqb-0002', ['B'], 1000, 'yesterday')] }, 'invalid'],
		['an unknown scenario', { mission: 'm-x', drills: [drill('nope', ['B'])] }, 'not-found']
	])('refuses %s and writes nothing', async (_name, body, reason) => {
		const result = await recordMission(vault, body);
		expect(result).toMatchObject({ ok: false, reason });
		expect(await loadAttempts(vault)).toEqual([]);
	});

	it('moves the overview’s accuracy for the tags it touched', async () => {
		await recordMission(vault, { mission: 'm-x', drills: [drill('cqb-0007', ['A'])] });
		const { tags, attempts } = await overview(vault);
		expect(attempts).toBe(1);
		expect(tags[0]).toMatchObject({ tag: 'cqb.threshold', answers: 1 });
	});
});

describe('setStatus', () => {
	const path = 'Tactics/Scenarios/cqb-0002.md';

	beforeEach(async () => {
		await addStarters(vault);
	});

	it('will not approve while the Why is still a suggestion', async () => {
		const before = (await vault.read(path)).content;
		const result = await setStatus(vault, 'cqb-0002', 'approved');
		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read(path)).content).toBe(before);
	});

	it('approves once the Why is yours, changing only the status line', async () => {
		const before = (await vault.read(path)).content;
		const mine = before.replace(/## Why\n[\s\S]*$/, '## Why\nTwo doorways, one gun.\n');
		await vault.write(path, mine);
		expect(await setStatus(vault, 'cqb-0002', 'approved')).toEqual({ ok: true, status: 'approved' });
		expect((await vault.read(path)).content).toBe(mine.replace('status: draft', 'status: approved'));
	});

	it('retires without asking for a Why', async () => {
		expect(await setStatus(vault, 'cqb-0002', 'retired')).toEqual({ ok: true, status: 'retired' });
	});

	it('refuses an unknown status or scenario', async () => {
		expect(await setStatus(vault, 'cqb-0002', 'live')).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await setStatus(vault, 'nope', 'retired')).toMatchObject({ ok: false, reason: 'not-found' });
	});
});

describe('loadLibrary', () => {
	it('reports a second note with an id already used', async () => {
		await addStarters(vault);
		const copy = (await vault.read('Tactics/Scenarios/cqb-0002.md')).content;
		await vault.write('Tactics/Scenarios/Old/copy.md', copy);
		const { problems } = await loadLibrary(vault);
		expect(problems).toHaveLength(1);
		expect(problems[0].errors[0]).toMatch(/already used/);
	});
});

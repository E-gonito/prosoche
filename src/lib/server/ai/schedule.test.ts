import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { STATE_PATH, due, tick, type Job } from './schedule';

const at = (day: string, hour: number, minute = 0) => {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d, hour, minute);
};

// 2026-09-21 is a Monday; 2026-09-20 is a Sunday.
const MONDAY = '2026-09-21';
const SUNDAY = '2026-09-20';

const daily: Job = { id: 'briefing', atMin: 7 * 60, run: async () => {} };
const sunday: Job = { id: 'weekly-review', atMin: 18 * 60, onWeekday: 0, run: async () => {} };

describe('due', () => {
	it('holds a job until its time', () => {
		expect(due([daily], at(MONDAY, 6, 55), {})).toEqual([]);
		expect(due([daily], at(MONDAY, 7, 0), {})).toEqual([daily]);
	});

	it('still runs a job for a machine opened late', () => {
		expect(due([daily], at(MONDAY, 9, 20), {})).toEqual([daily]);
	});

	it('does not run a job twice in one day', () => {
		expect(due([daily], at(MONDAY, 9, 20), { briefing: MONDAY })).toEqual([]);
	});

	it('runs again the next day', () => {
		expect(due([daily], at(MONDAY, 7, 0), { briefing: SUNDAY })).toEqual([daily]);
	});

	it('keeps a weekly job to its weekday', () => {
		expect(due([sunday], at(MONDAY, 19), {})).toEqual([]);
		expect(due([sunday], at(SUNDAY, 19), {})).toEqual([sunday]);
	});

	it('does not run a weekly job before its hour, even on the day', () => {
		expect(due([sunday], at(SUNDAY, 9), {})).toEqual([]);
	});
});

describe('tick', () => {
	let dir: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'schedule-'));
		vault = new Vault(dir);
		index = new NoteIndex(':memory:');
		// The layer is off in a vault with no `_hub/ai.md`; these tests are
		// about what happens once it is on.
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
	});

	afterEach(async () => {
		index.close();
		await rm(dir, { recursive: true, force: true });
	});

	const ran: string[] = [];
	const spy: Job = {
		id: 'briefing',
		atMin: 0,
		run: async () => {
			ran.push('briefing');
		}
	};

	it('runs a due job and records it, so the next tick does not', async () => {
		ran.length = 0;
		const now = at(MONDAY, 8);
		expect(await tick({ vault, index }, [spy], now)).toEqual(['briefing']);
		expect(await tick({ vault, index }, [spy], now)).toEqual([]);
		expect(ran).toEqual(['briefing']);

		const state = JSON.parse((await vault.read(STATE_PATH)).content);
		expect(state).toEqual({ briefing: MONDAY });
	});

	it('runs nothing at all while the kill switch is off', async () => {
		ran.length = 0;
		await vault.write('_hub/ai.md', '---\nenabled: false\n---\n');
		expect(await tick({ vault, index }, [spy], at(MONDAY, 8))).toEqual([]);
		expect(ran).toEqual([]);
	});

	it('records a job that threw, so a failure does not repeat every tick', async () => {
		const angry: Job = {
			id: 'briefing',
			atMin: 0,
			run: async () => {
				throw new Error('no');
			}
		};
		const now = at(MONDAY, 8);
		expect(await tick({ vault, index }, [angry], now)).toEqual([]);
		expect(JSON.parse((await vault.read(STATE_PATH)).content)).toEqual({ briefing: MONDAY });
		expect(await tick({ vault, index }, [angry], now)).toEqual([]);
	});

	it('survives a half-written state file', async () => {
		ran.length = 0;
		await vault.write(STATE_PATH, '{"briefing":');
		expect(await tick({ vault, index }, [spy], at(MONDAY, 8))).toEqual(['briefing']);
	});
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Vault } from '../vault/index';
import { nowStrip } from './now';
import { startBlockSession } from './session';

const DAY = '2026-10-21';
const NOTE_PATH = 'Journal/2026/10/21.md';
const at = (h: number, m: number, s = 0) => new Date(2026, 9, 21, h, m, s);

const NOTE = [
	'# Tasks',
	'- [ ] Meditate `Q1`',
	'- [ ] 17:00 - 17:30 Cook dinner `Q2`',
	'- [ ] 18:00 - 18:30 Cusina Ko',
	'- [ ] 18:00 - 19:00 Kaya',
	'- [x] 08:00 - 08:30 Ticked',
	''
].join('\n');

describe('the now strip', () => {
	let root: string;
	let vault: Vault;
	const put = async (path: string, content: string) => {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	};

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'prosoche-now-'));
		vault = new Vault(root);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('is null with no note for the day', async () => {
		expect(await nowStrip(vault, at(17, 0))).toBeNull();
	});

	it('is null when nothing is near', async () => {
		await put(NOTE_PATH, NOTE);
		expect(await nowStrip(vault, at(12, 0))).toBeNull();
	});

	it('is soon before a block, counting to its start in the server’s time', async () => {
		await put(NOTE_PATH, NOTE);
		const now = at(16, 51, 30);
		expect(await nowStrip(vault, now)).toEqual({
			state: 'soon',
			day: DAY,
			startMin: 1020,
			startAt: at(17, 0).getTime(),
			blocks: [{ line: 2, text: 'Cook dinner', startMin: 1020, endMin: 1050 }],
			serverNow: now.getTime()
		});
	});

	it('is due from the start, and shares one strip between blocks starting together', async () => {
		await put(NOTE_PATH, NOTE);
		expect(await nowStrip(vault, at(17, 4))).toMatchObject({ state: 'due', startMin: 1020, blocks: [{ text: 'Cook dinner' }] });
		const group = await nowStrip(vault, at(18, 2));
		expect(group).toMatchObject({ state: 'due', startMin: 1080 });
		expect(group?.state === 'due' && group.blocks.map((b) => [b.line, b.text])).toEqual([
			[3, 'Cusina Ko'],
			[4, 'Kaya']
		]);
	});

	it('shows the running session over any due block, on any day', async () => {
		await put(NOTE_PATH, NOTE);
		const started = await startBlockSession(vault, { day: DAY, line: 2, raw: '- [ ] 17:00 - 17:30 Cook dinner `Q2`' }, at(17, 0).getTime());
		expect(started.ok).toBe(true);
		const now = at(18, 2);
		expect(await nowStrip(vault, now)).toEqual({
			state: 'running',
			name: 'Cook dinner',
			startedAt: at(17, 0).getTime(),
			minutes: 30,
			warmupMin: 5,
			serverNow: now.getTime()
		});
		// Another day entirely: still running.
		expect(await nowStrip(vault, new Date(2026, 9, 25, 9, 0))).toMatchObject({ state: 'running' });
	});
});

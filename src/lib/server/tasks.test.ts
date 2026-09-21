import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { updateTask, moveBlock } from './tasks';
import { scanTasks } from './parse/task';

const NOTE = [
	'# Tasks',
	'- [ ] 09:30 - 10:00 Morning stretch `Q1`',
	'- [ ] 23:00 - 23:10 Write the daily log `Q1`',
	'\t- What am I avoiding, and why',
	'- [ ] Walk the dog `Q1` ',
	''
].join('\n');

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-tasks-'));
	vault = new Vault(root);
	await vault.write('day.md', NOTE);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('updateTask', () => {
	it('ticks a task and leaves every other line byte-identical', async () => {
		const before = (await vault.read('day.md')).content.split('\n');
		const result = await updateTask(vault, 'day.md', 1, before[1], { status: 'done' });
		expect(result.ok).toBe(true);

		const after = (await vault.read('day.md')).content.split('\n');
		expect(after[1]).toBe('- [x] 09:30 - 10:00 Morning stretch `Q1`');
		expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
	});

	it('preserves trailing whitespace on the edited line', async () => {
		const lines = (await vault.read('day.md')).content.split('\n');
		await updateTask(vault, 'day.md', 4, lines[4], { status: 'done' });
		expect((await vault.read('day.md')).content.split('\n')[4]).toBe('- [x] Walk the dog `Q1` ');
	});

	it('reschedules without touching the text or the sub-bullet', async () => {
		const lines = (await vault.read('day.md')).content.split('\n');
		await updateTask(vault, 'day.md', 2, lines[2], { time: { start: '21:00', end: '21:20' } });
		const after = (await vault.read('day.md')).content.split('\n');
		expect(after[2]).toBe('- [ ] 21:00 - 21:20 Write the daily log `Q1`');
		expect(after[3]).toBe('\t- What am I avoiding, and why');
	});

	it('refuses when that line changed underneath, and says what it is now', async () => {
		const stale = '- [ ] 09:30 - 10:00 Morning stretch `Q1`';
		const lines = (await vault.read('day.md')).content.split('\n');
		lines[1] = '- [x] 09:30 - 10:00 Morning stretch `Q1`';
		await vault.write('day.md', lines.join('\n'));

		const result = await updateTask(vault, 'day.md', 1, stale, { status: 'done' });
		expect(result).toEqual({ ok: false, reason: 'line-changed', current: '- [x] 09:30 - 10:00 Morning stretch `Q1`' });
	});

	it('still ticks when a different line changed', async () => {
		const lines = (await vault.read('day.md')).content.split('\n');
		const target = lines[1];
		lines[0] = '# Tasks for today';
		await vault.write('day.md', lines.join('\n'));

		const result = await updateTask(vault, 'day.md', 1, target, { status: 'done' });
		expect(result.ok).toBe(true);
		expect((await vault.read('day.md')).content).toContain('# Tasks for today');
	});

	it('refuses a line that is not a task', async () => {
		const lines = (await vault.read('day.md')).content.split('\n');
		expect(await updateTask(vault, 'day.md', 0, lines[0], { status: 'done' })).toEqual({
			ok: false,
			reason: 'not-a-task'
		});
	});

	it('refuses a note that does not exist', async () => {
		expect(await updateTask(vault, 'missing.md', 1, 'x', { status: 'done' })).toEqual({ ok: false, reason: 'no-note' });
	});

	it('is a no-op when the edit changes nothing', async () => {
		const lines = (await vault.read('day.md')).content.split('\n');
		const result = await updateTask(vault, 'day.md', 1, lines[1], { status: 'todo' });
		expect(result.ok).toBe(true);
		expect((await vault.read('day.md')).content).toBe(NOTE);
	});
});

describe('moveBlock', () => {
	it('carries sub-bullets with the task', () => {
		const journal = scanTasks(NOTE).find((t) => t.text.startsWith('Write the daily log'))!;
		const moved = moveBlock(NOTE, journal, 1).split('\n');
		expect(moved.slice(1, 4)).toEqual([
			'- [ ] 23:00 - 23:10 Write the daily log `Q1`',
			'\t- What am I avoiding, and why',
			'- [ ] 09:30 - 10:00 Morning stretch `Q1`'
		]);
	});

	it('keeps every line, just in a different order', () => {
		const first = scanTasks(NOTE)[0];
		const moved = moveBlock(NOTE, first, 5);
		expect(moved.split('\n').sort()).toEqual(NOTE.split('\n').sort());
	});
});

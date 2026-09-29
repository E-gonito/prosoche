import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { addLogUpdate, readLog } from './log';

describe('readLog', () => {
	it('groups lines under their day heading, newest first', () => {
		const content = [
			'# Log',
			'',
			'## 2026-09-20',
			'- First session',
			'- Second note',
			'',
			'## 2026-09-25',
			'- Later session'
		].join('\n');
		expect(readLog(content)).toEqual([
			{ day: '2026-09-25', lines: ['- Later session'] },
			{ day: '2026-09-20', lines: ['- First session', '- Second note'] }
		]);
	});

	it('leaves a section at the next heading of any level', () => {
		const content = ['## 2026-09-20', '- A line', '### Aside', '- Not part of the day'].join('\n');
		expect(readLog(content)).toEqual([{ day: '2026-09-20', lines: ['- A line'] }]);
	});

	it('is empty for a file with no dated headings', () => {
		expect(readLog('# Log\n\nNothing yet.\n')).toEqual([]);
	});
});

describe('addLogUpdate', () => {
	let root: string;
	let vault: Vault;
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-log-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('creates the note and the day heading on first use', async () => {
		const ok = await addLogUpdate(vault, 'Work/Log.md', 'Shipped the first cut', '2026-09-29');
		expect(ok).toBe(true);
		expect((await vault.read('Work/Log.md')).content).toBe('# Log\n\n## 2026-09-29\n- Shipped the first cut\n');
	});

	it('appends under an existing day rather than replacing it', async () => {
		await vault.write('Work/Log.md', '# Log\n\n## 2026-09-29\n- First update\n');
		await addLogUpdate(vault, 'Work/Log.md', 'Second update', '2026-09-29');
		expect((await vault.read('Work/Log.md')).content).toBe('# Log\n\n## 2026-09-29\n- First update\n- Second update\n');
	});

	it('never touches an earlier day', async () => {
		await vault.write('Work/Log.md', '# Log\n\n## 2026-09-20\n- Old session\n');
		await addLogUpdate(vault, 'Work/Log.md', 'New session', '2026-09-29');
		const content = (await vault.read('Work/Log.md')).content;
		expect(content).toContain('## 2026-09-20\n- Old session');
		expect(content).toContain('## 2026-09-29\n- New session');
	});

	it('refuses an empty update', async () => {
		expect(await addLogUpdate(vault, 'Work/Log.md', '   ')).toBe(false);
		expect((await vault.read('Work/Log.md')).exists).toBe(false);
	});
});

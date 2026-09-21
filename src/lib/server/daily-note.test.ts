import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { openDay, dayExists } from './daily-note';

const TEMPLATE = ['# [[Journal 2026]]', '', '# Tasks', '- [ ] Morning stretch `Q1`', '- [ ] Walk the dog `Q1` ', ''].join('\n');

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-daily-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('openDay', () => {
	it('copies the template verbatim, quirks included', async () => {
		await vault.write('Journal/Journal Template.md', TEMPLATE);
		const note = await openDay(vault, '2026-09-22');
		expect(note.path).toBe('Journal/2026/09/22.md');
		expect(note.content).toBe(TEMPLATE);
	});

	it('never overwrites a day that already has a note', async () => {
		await vault.write('Journal/Journal Template.md', TEMPLATE);
		await vault.write('Journal/2026/09/22.md', '# my own day\n');
		expect((await openDay(vault, '2026-09-22')).content).toBe('# my own day\n');
	});

	it('still produces a usable day when there is no template', async () => {
		const note = await openDay(vault, '2026-09-22');
		expect(note.exists).toBe(true);
		expect(note.content).toContain('# Tasks');
	});
});

describe('dayExists', () => {
	it('does not create the note just by asking', async () => {
		await vault.write('Journal/Journal Template.md', TEMPLATE);
		expect(await dayExists(vault, '2026-09-23')).toBe(false);
		expect(await dayExists(vault, '2026-09-23')).toBe(false);
		expect((await vault.read('Journal/2026/09/23.md')).exists).toBe(false);
	});
});

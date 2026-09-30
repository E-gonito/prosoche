import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { inScope, scopedNotes } from './scope';

describe('inScope', () => {
	it('lets everything through when nothing is named', () => {
		expect(inScope('anywhere/x.md', [], undefined)).toBe(true);
		expect(inScope('anywhere/x.md', [], {})).toBe(true);
	});

	it('matches a folder but not a folder that merely starts the same way', () => {
		expect(inScope('CS/x.md', [], { folders: ['CS'] })).toBe(true);
		expect(inScope('CSS/x.md', [], { folders: ['CS'] })).toBe(false);
	});

	it('matches a tag on the note, including a nested one', () => {
		expect(inScope('Anywhere/x.md', ['ws/personal/reading'], { tags: ['ws/personal'] })).toBe(true);
		expect(inScope('Anywhere/x.md', ['ws/work'], { tags: ['ws/personal'] })).toBe(false);
	});
});

describe('scopedNotes', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-scope-'));
		vault = new Vault(root);
		await vault.write('CS/Networking/HTTP.md', '# HTTP\n');
		await vault.write('Art/Sketching.md', '# Sketching\n\n#ws/cs\n');
		await vault.write('_hub/workspaces/cs.md', '---\nname: CS\n---\n');
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('reads the notes in scope, by folder or tag, and never the hub’s own files', async () => {
		const notes = await scopedNotes(vault, { folders: ['CS'], tags: ['ws/cs'] });
		expect(notes.map((n) => n.path).sort()).toEqual(['Art/Sketching.md', 'CS/Networking/HTTP.md']);
		expect(notes[0].hash).toBe((await vault.read(notes[0].path)).hash);
	});
});

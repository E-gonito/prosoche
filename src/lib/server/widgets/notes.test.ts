import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { recentNotes } from './notes';

let root: string;
let vault: Vault;
let index: NoteIndex;

/**
 * Put a note in the vault and record it in the index with a chosen mtime, so
 * ordering in a test does not depend on how fast the filesystem's clock
 * ticks between two writes.
 */
async function add(path: string, content: string, mtimeMs: number) {
	await vault.write(path, content);
	index.put(path, content, mtimeMs);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-notes-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
});
afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('recentNotes', () => {
	it('titles a note by its file name, not its own heading', async () => {
		await add('Work/TIMESHEET SEPTEMBER.md', '# 01/09/2026\n\nEntries.\n', 1000);
		const { notes } = await recentNotes(vault, index, { under: ['Work'], limit: 10 });
		expect(notes[0].title).toBe('TIMESHEET SEPTEMBER');
	});

	it('carries the note\'s own title as a subtitle only when it differs from the file name', async () => {
		await add('Work/TIMESHEET SEPTEMBER.md', '# 01/09/2026\n\nEntries.\n', 2000);
		await add('Work/Spec.md', '# Spec\n\nDetails.\n', 1000);
		const { notes } = await recentNotes(vault, index, { under: ['Work'], limit: 10 });
		expect(notes.find((n) => n.path.endsWith('TIMESHEET SEPTEMBER.md'))?.subtitle).toBe('01/09/2026');
		// The heading matches the file name here, so there is nothing to add.
		expect(notes.find((n) => n.path.endsWith('Spec.md'))?.subtitle).toBe('');
	});

	it('groups by the first subfolder under the workspace folder', async () => {
		await add('Work/QMS/Policy.md', '# Quality Policy\n\nBody.\n', 3000);
		await add('Work/Data Portal/Spec.md', '# Spec\n\nBody.\n', 2000);
		await add('Work/TIMESHEET SEPTEMBER.md', '# 01/09/2026\n\nBody.\n', 1000);
		const { notes } = await recentNotes(vault, index, { under: ['Work'], limit: 10 });
		// A note directly in the workspace folder lands in the unnamed first group.
		expect(notes.map((n) => n.group)).toEqual(['QMS', 'Data Portal', '']);
	});

	it('groups by top-level folder when there is no workspace', async () => {
		await add('Work/Atlas/Tasks.md', '# Tasks\n', 2000);
		await add('Idea.md', '# Idea\n', 1000);
		const { notes } = await recentNotes(vault, index, { under: [], limit: 10 });
		expect(notes.map((n) => n.group)).toEqual(['Work', '']);
	});

	it('leaves _hub/ out of both the list and the total', async () => {
		await add('_hub/workspaces/atlas.md', '# Atlas\n', 2000);
		await add('Work/Spec.md', '# Spec\n', 1000);
		const { notes, total } = await recentNotes(vault, index, { under: [], limit: 10 });
		expect(notes.map((n) => n.path)).toEqual(['Work/Spec.md']);
		expect(total).toBe(1);
	});

	it('counts everything in scope, not just the page shown', async () => {
		await add('Work/One.md', '# One\n', 3000);
		await add('Work/Two.md', '# Two\n', 2000);
		await add('Work/Three.md', '# Three\n', 1000);
		const { notes, total } = await recentNotes(vault, index, { under: ['Work'], limit: 2 });
		expect(notes).toHaveLength(2);
		expect(total).toBe(3);
	});

	it('is newest first', async () => {
		await add('Work/Old.md', '# Old\n', 1000);
		await add('Work/New.md', '# New\n', 5000);
		await add('Work/Mid.md', '# Mid\n', 3000);
		const { notes } = await recentNotes(vault, index, { under: ['Work'], limit: 10 });
		expect(notes.map((n) => n.path)).toEqual(['Work/New.md', 'Work/Mid.md', 'Work/Old.md']);
	});

	it('reads only the notes it shows, for the one-line preview', async () => {
		await add('Work/Shown.md', '# Shown\n\nThe visible line.\n', 2000);
		await add('Work/Hidden.md', '# Hidden\n\nNever read.\n', 1000);
		const { notes } = await recentNotes(vault, index, { under: ['Work'], limit: 1 });
		expect(notes).toHaveLength(1);
		expect(notes[0].preview).toBe('The visible line.');
	});
});

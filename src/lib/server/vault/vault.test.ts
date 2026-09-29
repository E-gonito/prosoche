import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, ScopeError, hashContent } from './index';
import { noSync } from './sync';

let root: string;
let vault: Vault;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-vault-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('read', () => {
	it('returns an empty note for a file that does not exist', async () => {
		const note = await vault.read('Journal/2026/09/22.md');
		expect(note.exists).toBe(false);
		expect(note.content).toBe('');
	});

	it('reads content and hashes it', async () => {
		await vault.write('note.md', '# Hello');
		const note = await vault.read('note.md');
		expect(note.content).toBe('# Hello');
		expect(note.hash).toBe(hashContent('# Hello'));
	});
});

describe('write', () => {
	it('creates parent folders', async () => {
		const result = await vault.write('Journal/2026/09/22.md', 'today');
		expect(result.ok).toBe(true);
		expect((await vault.read('Journal/2026/09/22.md')).content).toBe('today');
	});

	it('reports a conflict instead of overwriting a changed file', async () => {
		await vault.write('note.md', 'original');
		const stale = hashContent('original');
		await vault.write('note.md', 'changed on another device');

		const result = await vault.write('note.md', 'my edit', stale);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.current.content).toBe('changed on another device');
		expect(result.yourContent).toBe('my edit');
		expect((await vault.read('note.md')).content).toBe('changed on another device');
	});

	it('accepts a write when the hash still matches', async () => {
		const first = await vault.write('note.md', 'v1');
		expect(first.ok).toBe(true);
		if (!first.ok) return;
		const second = await vault.write('note.md', 'v2', first.note.hash);
		expect(second.ok).toBe(true);
	});

	it('allows a first write with no hash', async () => {
		expect((await vault.write('new.md', 'x')).ok).toBe(true);
	});
});

describe('list and tree', () => {
	beforeEach(async () => {
		await mkdir(join(root, 'Journal/2026/09'), { recursive: true });
		await mkdir(join(root, '.obsidian'), { recursive: true });
		await mkdir(join(root, 'Images'), { recursive: true });
		await writeFile(join(root, 'Journal/2026/09/21.md'), 'a');
		await writeFile(join(root, 'Journal/Journal.md'), 'b');
		await writeFile(join(root, '.obsidian/app.json'), '{}');
		await writeFile(join(root, 'Images/pic.png'), 'binary');
	});

	it('lists only markdown outside ignored folders', async () => {
		expect(await vault.list()).toEqual(['Journal/2026/09/21.md', 'Journal/Journal.md']);
	});

	it('builds a tree with folders before notes', async () => {
		const tree = await vault.tree();
		expect(tree).toHaveLength(1);
		const journal = tree[0];
		expect(journal.type).toBe('folder');
		if (journal.type !== 'folder') return;
		expect(journal.children.map((c) => c.type)).toEqual(['folder', 'note']);
		expect(journal.children[1].name).toBe('Journal');
	});
});

describe('subscribe', () => {
	it('tells listeners about the hub\'s own writes', async () => {
		const seen: string[] = [];
		vault.subscribe((c) => seen.push(`${c.kind}:${c.path}:${c.self}`));
		await vault.write('note.md', 'x');
		await vault.write('note.md', 'y');
		expect(seen).toEqual(['added:note.md:true', 'changed:note.md:true']);
	});

	it('keeps working when a listener throws', async () => {
		const seen: string[] = [];
		vault.subscribe(() => {
			throw new Error('bad listener');
		});
		vault.subscribe((c) => seen.push(c.path));
		expect((await vault.write('note.md', 'x')).ok).toBe(true);
		expect(seen).toEqual(['note.md']);
	});
});

describe('the private folder', () => {
	it('does not exist to a public caller', async () => {
		await vault.write('Private/Dating/Ledger.md', 'secret', undefined, { scope: 'private' });
		await vault.write('Notes.md', 'public');

		expect((await vault.read('Private/Dating/Ledger.md')).exists).toBe(false);
		expect(await vault.list()).toEqual(['Notes.md']);
		expect(JSON.stringify(await vault.tree())).not.toContain('Private');
	});

	it('is all a private caller sees', async () => {
		await vault.write('Private/Dating/Ledger.md', 'secret', undefined, { scope: 'private' });
		await vault.write('Notes.md', 'public');

		expect((await vault.read('Private/Dating/Ledger.md', { scope: 'private' })).content).toBe('secret');
		expect((await vault.read('Notes.md', { scope: 'private' })).exists).toBe(false);
		expect(await vault.list({ scope: 'private' })).toEqual(['Private/Dating/Ledger.md']);
	});

	it('lists as empty before anything private exists', async () => {
		expect(await vault.list({ scope: 'private' })).toEqual([]);
	});

	it('refuses a write that names the wrong side', async () => {
		await expect(vault.write('Private/x.md', 'no')).rejects.toThrow(ScopeError);
		await expect(vault.write('x.md', 'no', undefined, { scope: 'private' })).rejects.toThrow(ScopeError);
	});

	it('is never announced to subscribers or marked for sync', async () => {
		const seen: string[] = [];
		const marked: string[] = [];
		const watched = new Vault(root, { ...noSync, markDirty: (p: string) => marked.push(p) });
		watched.subscribe((c) => seen.push(c.path));
		await watched.write('Private/a.md', 'x', undefined, { scope: 'private' });
		await watched.write('b.md', 'y');
		expect(seen).toEqual(['b.md']);
		expect(marked).toEqual(['b.md']);
	});
});

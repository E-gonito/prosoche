import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	listSnapshots,
	makeSandbox,
	pruneSnapshots,
	readSandboxChanges,
	readSnapshot,
	recordApplied,
	appliedResult,
	resolvesInsideVault,
	snapshot
} from './sandbox';

let vaultRoot: string;
let undoRoot: string;
let outside: string;

beforeEach(async () => {
	vaultRoot = await mkdtemp(join(tmpdir(), 'hub-sbx-vault-'));
	undoRoot = await mkdtemp(join(tmpdir(), 'hub-sbx-undo-'));
	outside = await mkdtemp(join(tmpdir(), 'hub-sbx-out-'));
	await mkdir(join(vaultRoot, 'Notes'), { recursive: true });
	await mkdir(join(vaultRoot, '.git'), { recursive: true });
	await mkdir(join(vaultRoot, '.obsidian'), { recursive: true });
	await writeFile(join(vaultRoot, 'Notes', 'a.md'), '# A\n');
	await writeFile(join(vaultRoot, 'Notes', 'b.md'), '# B\n');
	await writeFile(join(vaultRoot, '.git', 'config.md'), 'secret remote');
	await writeFile(join(vaultRoot, '.obsidian', 'app.md'), 'plugin config');
});
afterEach(async () => {
	for (const dir of [vaultRoot, undoRoot, outside]) await rm(dir, { recursive: true, force: true });
});

describe('makeSandbox', () => {
	it('copies the notes into a directory outside the vault', async () => {
		const sandbox = await makeSandbox(vaultRoot);
		expect(sandbox.root.startsWith(vaultRoot)).toBe(false);
		expect(await readFile(join(sandbox.root, 'Notes', 'a.md'), 'utf8')).toBe('# A\n');
		expect(sandbox.paths.sort()).toEqual(['Notes/a.md', 'Notes/b.md']);
		await sandbox.dispose();
	});

	it('never copies .git or .obsidian, so the CLI cannot reach the remote or the plugins', async () => {
		const sandbox = await makeSandbox(vaultRoot);
		const entries = await readdir(sandbox.root);
		expect(entries).not.toContain('.git');
		expect(entries).not.toContain('.obsidian');
		await sandbox.dispose();
	});

	it('does not follow a symlink that points out of the vault', async () => {
		await writeFile(join(outside, 'secret.md'), 'private key');
		await symlink(join(outside, 'secret.md'), join(vaultRoot, 'Notes', 'link.md'));
		const sandbox = await makeSandbox(vaultRoot);
		expect(sandbox.paths).not.toContain('Notes/link.md');
		await sandbox.dispose();
	});

	it('copies only the subtree it is given', async () => {
		await mkdir(join(vaultRoot, 'Work'), { recursive: true });
		await writeFile(join(vaultRoot, 'Work', 'c.md'), '# C\n');
		const sandbox = await makeSandbox(vaultRoot, 'Work');
		expect(sandbox.paths).toEqual(['Work/c.md']);
		await sandbox.dispose();
	});

	it('gives an empty sandbox for a subtree that does not exist', async () => {
		const sandbox = await makeSandbox(vaultRoot, 'NotThere');
		expect(sandbox.paths).toEqual([]);
		await sandbox.dispose();
	});

	it('disposes twice without complaint', async () => {
		const sandbox = await makeSandbox(vaultRoot);
		await sandbox.dispose();
		await expect(sandbox.dispose()).resolves.toBeUndefined();
	});
});

describe('readSandboxChanges', () => {
	it('reports only what changed, and never a deletion', async () => {
		const sandbox = await makeSandbox(vaultRoot);
		const before = new Map([
			['Notes/a.md', '# A\n'],
			['Notes/b.md', '# B\n']
		]);
		await writeFile(join(sandbox.root, 'Notes', 'a.md'), '# A\n\nadded by the run\n');
		await writeFile(join(sandbox.root, 'Notes', 'new.md'), 'a whole new note');
		await rm(join(sandbox.root, 'Notes', 'b.md'));

		const changes = await readSandboxChanges(sandbox, before);
		expect(changes.map((c) => c.path)).toEqual(['Notes/a.md', 'Notes/new.md']);
		expect(changes.find((c) => c.path === 'Notes/new.md')?.created).toBe(true);
		await sandbox.dispose();
	});
});

describe('resolvesInsideVault', () => {
	it('is true for an ordinary path', async () => {
		expect(await resolvesInsideVault('Notes/a.md', vaultRoot)).toBe(true);
	});

	it('is true for a file that does not exist yet', async () => {
		expect(await resolvesInsideVault('Notes/not-yet.md', vaultRoot)).toBe(true);
	});

	it('is false when a folder in the path is a link out of the vault', async () => {
		await symlink(outside, join(vaultRoot, 'Escape'));
		expect(await resolvesInsideVault('Escape/anything.md', vaultRoot)).toBe(false);
	});

	it('is false when the file itself is a link out of the vault', async () => {
		await writeFile(join(outside, 'secret.md'), 'x');
		await symlink(join(outside, 'secret.md'), join(vaultRoot, 'Notes', 'link.md'));
		expect(await resolvesInsideVault('Notes/link.md', vaultRoot)).toBe(false);
	});
});

describe('the undo store', () => {
	it('keeps the previous bytes, and gives them back', async () => {
		const entry = await snapshot('p1', [{ path: 'Notes/a.md', content: '# A\n' }], undoRoot);
		expect(await readSnapshot(entry.id, undoRoot)).toEqual([{ path: 'Notes/a.md', content: '# A\n' }]);
	});

	it('records that a file did not exist, so undo does not invent one', async () => {
		const entry = await snapshot('p2', [{ path: 'Notes/new.md', content: null }], undoRoot);
		expect(await readSnapshot(entry.id, undoRoot)).toEqual([{ path: 'Notes/new.md', content: null }]);
	});

	it('returns nothing for a snapshot that has been pruned', async () => {
		expect(await readSnapshot('never-existed', undoRoot)).toEqual([]);
	});

	it('lists snapshots newest first', async () => {
		await snapshot('p1', [{ path: 'a.md', content: 'x' }], undoRoot, new Date('2026-09-01T10:00:00Z'));
		await snapshot('p2', [{ path: 'b.md', content: 'y' }], undoRoot, new Date('2026-09-05T10:00:00Z'));
		expect((await listSnapshots(undoRoot)).map((s) => s.proposalId)).toEqual(['p2', 'p1']);
	});

	it('prunes what is older than seven days and keeps the rest', async () => {
		const now = new Date('2026-09-21T10:00:00Z');
		await snapshot('old', [{ path: 'a.md', content: 'x' }], undoRoot, new Date('2026-09-01T10:00:00Z'));
		await snapshot('new', [{ path: 'b.md', content: 'y' }], undoRoot, new Date('2026-09-20T10:00:00Z'));
		expect(await pruneSnapshots(7, undoRoot, now)).toBe(1);
		expect((await listSnapshots(undoRoot)).map((s) => s.proposalId)).toEqual(['new']);
	});

	it('remembers that a proposal was applied', async () => {
		expect(await appliedResult('p9', undoRoot)).toBeNull();
		await recordApplied('p9', { written: ['a.md'] }, undoRoot);
		expect(await appliedResult('p9', undoRoot)).toEqual({ written: ['a.md'] });
	});

	it('cannot be made to write a receipt outside its own directory', async () => {
		await recordApplied('../../escape', { written: [] }, undoRoot);
		const names = await readdir(join(undoRoot, 'applied'));
		expect(names).toEqual(['______escape.json']);
	});
});

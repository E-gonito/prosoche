import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	listSnapshots,
	pruneSnapshots,
	readSnapshot,
	recordApplied,
	appliedResult,
	resolvesInsideVault,
	snapshot
} from './undo';

let vaultRoot: string;
let undoRoot: string;
let outside: string;

beforeEach(async () => {
	vaultRoot = await mkdtemp(join(tmpdir(), 'hub-sbx-vault-'));
	undoRoot = await mkdtemp(join(tmpdir(), 'hub-sbx-undo-'));
	outside = await mkdtemp(join(tmpdir(), 'hub-sbx-out-'));
	await mkdir(join(vaultRoot, 'Notes'), { recursive: true });
	await writeFile(join(vaultRoot, 'Notes', 'a.md'), '# A\n');
});
afterEach(async () => {
	for (const dir of [vaultRoot, undoRoot, outside]) await rm(dir, { recursive: true, force: true });
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

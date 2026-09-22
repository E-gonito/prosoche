import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexVault } from './hub';
import { NoteIndex } from './index/index';
import { Vault } from './vault/index';

let root: string;
let vault: Vault;
let index: NoteIndex;
let rebuild: () => Promise<number>;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
	rebuild = indexVault(vault, index);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

/** The raw line the index holds for a task, or nothing if it holds none. */
const rawOf = (text: string): string | undefined =>
	index.findTasks({ limit: 50 }).find((t) => t.text.includes(text))?.raw;

/** Give the event loop its turns until something the vault set off has happened. */
async function until(done: () => boolean, turns = 100): Promise<void> {
	for (let i = 0; i < turns && !done(); i++) await new Promise((r) => setImmediate(r));
	if (!done()) throw new Error('the index never caught up');
}

describe('indexVault', () => {
	it('rebuilds the whole index from the markdown', async () => {
		await vault.write('A.md', '- [ ] one\n');
		await vault.write('B.md', '- [ ] two\n');
		index.forget('A.md');

		await rebuild();
		expect(
			index
				.findTasks({ limit: 50 })
				.map((t) => t.text)
				.sort()
		).toEqual(['one', 'two']);
	});

	it('forgets a note that went missing before the rebuild', async () => {
		await vault.write('A.md', '- [ ] one\n');
		await vault.write('Notes.md', '- [ ] Chase the sample files\n');
		await rm(join(root, 'Notes.md'));

		await rebuild();
		expect(rawOf('Chase the sample files')).toBeUndefined();
	});

	/*
	 * The regression this function exists for. A rebuild reads every note and
	 * only then replaces the index, so a write that landed in between used to
	 * be overwritten by the older snapshot with no event left to correct it:
	 * the index kept a line the file no longer had, and the next edit of that
	 * line came back as a conflict nobody could explain.
	 */
	it('keeps a change that lands while it is reading', async () => {
		const unpinned = '- [ ] Chase the sample files';
		await vault.write('Notes.md', `${unpinned} #pin\n`);
		await vault.write('Z.md', '- [ ] read last\n');

		// Change Notes.md after the rebuild has read it but before it has
		// written its snapshot, and let the subscription index the change
		// there. An index that is already right is what the rebuild used to
		// undo, and that window is the whole point of this test.
		const read = vault.read.bind(vault);
		vault.read = async (path: string) => {
			const note = await read(path);
			if (path === 'Z.md') {
				await vault.write('Notes.md', `${unpinned}\n`);
				await until(() => rawOf('Chase the sample files') === unpinned);
			}
			return note;
		};

		await rebuild();
		expect(rawOf('Chase the sample files')).toBe(unpinned);
	});
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, type TreeNode } from '../vault/index';
import { notePaths, readSubjectNote, subjectTree } from './notes';
import type { NoteIndex } from '../index/index';

const note = (path: string): TreeNode => ({ type: 'note', name: path.split('/').pop()!.replace(/\.md$/, ''), path });
const folder = (path: string, children: TreeNode[]): TreeNode => ({ type: 'folder', name: path.split('/').pop()!, path, children });

const TREE: TreeNode[] = [
	folder('Computer Science', [folder('Computer Science/Networking', [note('Computer Science/Networking/HTTP.md')]), note('Computer Science/Index.md')]),
	folder('Study', [folder('Study/Computer Science', [note('Study/Computer Science/Goals.md')])]),
	note('Loose.md')
];

describe('subjectTree', () => {
	it('keeps the subtree under each folder, in order, named by its full path', () => {
		const out = subjectTree(TREE, ['Study/Computer Science', 'Computer Science/']);
		expect(out.map((n) => n.name)).toEqual(['Study/Computer Science', 'Computer Science']);
		expect(notePaths(out)).toEqual(['Study/Computer Science/Goals.md', 'Computer Science/Networking/HTTP.md', 'Computer Science/Index.md']);
	});

	it('leaves out a folder that is not there, and one inside another it already has', () => {
		expect(subjectTree(TREE, ['Missing', 'Computer Science', 'Computer Science/Networking']).map((n) => n.name)).toEqual(['Computer Science']);
		expect(subjectTree(TREE, [])).toEqual([]);
	});
});

describe('readSubjectNote', () => {
	let root: string;
	let vault: Vault;
	const index = { resolveLink: (t: string) => (t === 'HTTP' ? 'Computer Science/Networking/HTTP.md' : null) } as unknown as NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'study-notes-'));
		vault = new Vault(root);
		await vault.write('Computer Science/Networking/TCP.md', '# TCP\n\nRuns under [[HTTP]]. #networking\n');
		await vault.write('Journal/2026/09/29.md', '# Today\n');
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('renders a note inside the subject, linking wikilinks to the reader', async () => {
		const read = await readSubjectNote(vault, index, ['Computer Science'], 'Computer Science/Networking/TCP.md');
		expect(read).toMatchObject({ path: 'Computer Science/Networking/TCP.md', title: 'TCP', tags: ['networking'] });
		expect(read!.html).toContain('href="/notes/Computer%20Science/Networking/HTTP.md"');
	});

	it.each([
		['a note outside the subject', 'Journal/2026/09/29.md'],
		['a missing note', 'Computer Science/Nope.md'],
		['a path that climbs out', 'Computer Science/../Journal/2026/09/29.md'],
		['a folder name that only starts the same', 'Computer Science Old/x.md'],
		['something that is not a note', 'Computer Science/Networking/diagram.png']
	])('reads %s as nothing', async (_, path) => {
		expect(await readSubjectNote(vault, index, ['Computer Science'], path)).toBeNull();
	});
});

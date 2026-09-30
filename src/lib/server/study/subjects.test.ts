import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { loadWorkspaces, type Workspace } from '../workspaces';
import { createSubject, studyHome, subjectOf, subjectsOf } from './subjects';

const workspace = (slug: string, folders: string[], template?: string): Workspace => ({
	slug,
	name: slug,
	color: '#7c3aed',
	tag: `ws/${slug}`,
	aliases: [],
	folders,
	template,
	path: `_hub/workspaces/${slug}.md`
});

describe('subjectsOf', () => {
	const all = [workspace('work', ['Work']), workspace('cs-study', ['Study/Computer Science', 'Computer Science'], 'study'), workspace('bare', [], 'study')];

	it('is every study workspace, with its files in its home folder and every folder in scope', () => {
		const [cs, bare] = subjectsOf(all);
		expect(cs).toMatchObject({
			slug: 'cs-study',
			home: 'Study/Computer Science',
			scope: { folders: ['Study/Computer Science', 'Computer Science'], tags: ['ws/cs-study'] },
			files: {
				goals: 'Study/Computer Science/Goals.md',
				reading: 'Study/Computer Science/Reading List.md',
				sessions: 'Study/Computer Science/Sessions.md'
			}
		});
		// A subject naming no folder still has one place for its files.
		expect(bare.home).toBe('Inbox');
	});


	it('finds one subject, and its study home, by slug', () => {
		expect(subjectOf(all, 'cs-study')?.name).toBe('cs-study');
		expect(subjectOf(all, 'work')).toBeNull();
		expect(studyHome(all, 'cs-study')).toBe('Study/Computer Science');
		expect(studyHome(all, 'nope')).toBeNull();
	});
});

describe('createSubject', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-subjects-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('writes a study workspace homed at Study/<name>, with reference folders after it', async () => {
		const created = await createSubject(vault, [], { name: ' Filipino ', extraFolders: [' Languages/Filipino/ ', ''] });
		expect(created).toMatchObject({ ok: true, subject: { slug: 'filipino', name: 'Filipino', home: 'Study/Filipino' } });
		const [loaded] = await loadWorkspaces(vault);
		expect(loaded).toMatchObject({ slug: 'filipino', template: 'study', folders: ['Study/Filipino', 'Languages/Filipino'] });
	});

	it('takes the characters a folder or a link cannot hold out of the name', async () => {
		const created = await createSubject(vault, [], { name: 'C/C++: the [hard] way' });
		expect(created).toMatchObject({ ok: true, subject: { name: 'C C++ the hard way', home: 'Study/C C++ the hard way' } });
	});

	it('picks a colour no other subject has', async () => {
		const first = await createSubject(vault, [], { name: 'One' });
		const second = await createSubject(vault, await loadWorkspaces(vault), { name: 'Two' });
		expect(first.ok && second.ok && first.subject.color !== second.subject.color).toBe(true);
	});

	it('refuses no name and a taken name', async () => {
		expect(await createSubject(vault, [], { name: ' / ' })).toMatchObject({ ok: false, reason: 'no-name' });
		await createSubject(vault, [], { name: 'Filipino' });
		expect(await createSubject(vault, [], { name: 'filipino' })).toMatchObject({ ok: false, reason: 'exists' });
	});
});

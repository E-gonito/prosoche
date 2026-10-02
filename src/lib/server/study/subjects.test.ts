import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { loadWorkspaces } from '../workspaces';
import { adoptStudyWorkspaces, createSubject, deleteSubject, editSubject, loadSubjects, readSubject, subjectOf } from './subjects';

const CS = `---
name: CS study
color: "#7c3aed"
tag: ws/cs-study
folders:
  - "Study/Computer Science"
  - "Computer Science"
---

Computers, mostly.
`;

describe('readSubject', () => {
	it('is the file’s subject, with its files in its home folder and every folder in scope', () => {
		expect(readSubject('_hub/subjects/cs-study.md', CS)).toMatchObject({
			slug: 'cs-study',
			name: 'CS study',
			color: '#7c3aed',
			home: 'Study/Computer Science',
			path: '_hub/subjects/cs-study.md',
			scope: { folders: ['Study/Computer Science', 'Computer Science'], tags: ['ws/cs-study'] },
			files: {
				goals: 'Study/Computer Science/Goals.md',
				reading: 'Study/Computer Science/Reading List.md'
			}
		});
	});

	it('homes a subject naming no folder at Study/<name>, in scope on its own, with no tag', () => {
		const bare = readSubject('_hub/subjects/bare.md', '---\nname: Bare\n---\n');
		expect(bare).toMatchObject({ home: 'Study/Bare', scope: { folders: ['Study/Bare'], tags: [] } });
	});
});

describe('subjects on disk', () => {
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

	it('are the files in _hub/subjects/, and never a workspace', async () => {
		await vault.write('_hub/subjects/cs-study.md', CS);
		await vault.write('_hub/workspaces/work.md', '---\nname: Work\nfolders:\n  - Work\n---\n');
		const subjects = await loadSubjects(vault);
		expect(subjects.map((s) => s.slug)).toEqual(['cs-study']);
		expect(subjectOf(subjects, 'cs-study')?.name).toBe('CS study');
		expect(subjectOf(subjects, 'work')).toBeNull();
		expect((await loadWorkspaces(vault)).map((w) => w.slug)).toEqual(['work']);
	});

	it('creates a subject file homed at Study/<name>, with reference folders after it, and no workspace', async () => {
		const created = await createSubject(vault, { name: ' Filipino ', extraFolders: [' Languages/Filipino/ ', ''] });
		expect(created).toMatchObject({ ok: true, subject: { slug: 'filipino', name: 'Filipino', home: 'Study/Filipino' } });
		const [loaded] = await loadSubjects(vault);
		expect(loaded).toMatchObject({ slug: 'filipino', scope: { folders: ['Study/Filipino', 'Languages/Filipino'], tags: [] } });
		expect((await vault.read('_hub/subjects/filipino.md')).content).toContain('\nfolders:\n  - "Study/Filipino"\n  - "Languages/Filipino"\n---\n');
		expect(await loadWorkspaces(vault)).toEqual([]);
	});

	it('takes the characters a folder or a link cannot hold out of the name', async () => {
		const created = await createSubject(vault, { name: 'C/C++: the [hard] way' });
		expect(created).toMatchObject({ ok: true, subject: { name: 'C C++ the hard way', home: 'Study/C C++ the hard way' } });
	});

	it('picks a colour no other subject has', async () => {
		const first = await createSubject(vault, { name: 'One' });
		const second = await createSubject(vault, { name: 'Two' });
		expect(first.ok && second.ok && first.subject.color !== second.subject.color).toBe(true);
	});

	it('refuses no name and a taken name, but not a workspace’s', async () => {
		expect(await createSubject(vault, { name: ' / ' })).toMatchObject({ ok: false, reason: 'no-name' });
		await createSubject(vault, { name: 'Filipino' });
		expect(await createSubject(vault, { name: 'filipino' })).toMatchObject({ ok: false, reason: 'exists' });
		await vault.write('_hub/workspaces/eye2gene.md', '---\nname: eye2gene\n---\n');
		expect(await createSubject(vault, { name: 'eye2gene' })).toMatchObject({ ok: true });
	});

	it('edits only the lines asked for, keeping the home first and every other byte', async () => {
		await vault.write('_hub/subjects/cs-study.md', CS);
		const [cs] = await loadSubjects(vault);
		expect(await editSubject(vault, cs, { folders: ['Computer Science', 'Papers/ML'], name: 'Computing', tag: '' })).toEqual({ ok: true, path: cs.path });
		expect((await vault.read(cs.path)).content).toBe(
			CS.replace('name: CS study', 'name: Computing').replace('tag: ws/cs-study', 'tag:').replace('  - "Computer Science"\n', '  - Computer Science\n  - Papers/ML\n').replace('  - "Study/Computer Science"', '  - Study/Computer Science')
		);
		const [edited] = await loadSubjects(vault);
		expect(edited).toMatchObject({ name: 'Computing', scope: { folders: ['Study/Computer Science', 'Computer Science', 'Papers/ML'], tags: [] } });
	});

	it('refuses an edit it will not write, and writes nothing', async () => {
		await vault.write('_hub/subjects/cs-study.md', CS);
		const [cs] = await loadSubjects(vault);
		for (const edit of [{ name: ' ' }, { color: 'purple' }, { tag: 'ws/cs study' }, { folders: ['../outside'] }]) {
			expect(await editSubject(vault, cs, edit)).toMatchObject({ ok: false, reason: 'invalid' });
		}
		expect((await vault.read(cs.path)).content).toBe(CS);
	});

	it('deletes only the subject’s file', async () => {
		await vault.write('_hub/subjects/cs-study.md', CS);
		await vault.write('Study/Computer Science/Goals.md', '## Networks\n');
		expect(await deleteSubject(vault, 'cs-study')).toEqual({ ok: true });
		expect(await loadSubjects(vault)).toEqual([]);
		expect((await vault.read('Study/Computer Science/Goals.md')).exists).toBe(true);
		expect(await deleteSubject(vault, 'cs-study')).toEqual({ ok: false, reason: 'not-found' });
		expect(await deleteSubject(vault, '../workspaces/work')).toEqual({ ok: false, reason: 'not-found' });
	});

	it('moves a study workspace to a subject file byte for byte, once, and leaves other workspaces alone', async () => {
		const old = CS.replace('tag: ws/cs-study\n', 'tag: ws/cs-study\ntemplate: study\n');
		await vault.write('_hub/workspaces/cs-study.md', old);
		await vault.write('_hub/workspaces/work.md', '---\nname: Work\ntemplate: project\n---\n');
		expect(await adoptStudyWorkspaces(vault)).toEqual(['_hub/subjects/cs-study.md']);
		expect((await vault.read('_hub/subjects/cs-study.md')).content).toBe(old);
		expect((await vault.read('_hub/workspaces/cs-study.md')).exists).toBe(false);
		expect((await loadWorkspaces(vault)).map((w) => w.slug)).toEqual(['work']);
		expect(await adoptStudyWorkspaces(vault)).toEqual([]);
	});

	it('leaves a study workspace where it is when a subject file already has its slug', async () => {
		await vault.write('_hub/subjects/cs-study.md', CS);
		await vault.write('_hub/workspaces/cs-study.md', '---\nname: Other\ntemplate: study\n---\n');
		expect(await adoptStudyWorkspaces(vault)).toEqual([]);
		expect((await vault.read('_hub/subjects/cs-study.md')).content).toBe(CS);
		expect((await vault.read('_hub/workspaces/cs-study.md')).exists).toBe(true);
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { createWorkspace, deleteWorkspace, loadWorkspaces, seedWorkspaces, setReferenceFolders, workspaceFor, type Workspace } from './workspaces';

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ws-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('seedWorkspaces and loadWorkspaces', () => {
	it('writes the starting workspaces and reads them back', async () => {
		const written = await seedWorkspaces(vault);
		expect(written).toHaveLength(4);

		const loaded = await loadWorkspaces(vault);
		expect(loaded.map((w) => w.slug).sort()).toEqual(['personal', 'side-projects', 'study', 'work']);
		const work = loaded.find((w) => w.slug === 'work')!;
		expect(work.folders).toEqual(['Work']);
	});

	it('writes no tabs: block; the vault format no longer has one', async () => {
		await seedWorkspaces(vault);
		expect((await vault.read('_hub/workspaces/work.md')).content).not.toContain('tabs:');
	});

	it('writes no aliases block, because none of the seeds has one', async () => {
		await seedWorkspaces(vault);
		for (const path of ['work', 'study', 'personal', 'side-projects']) {
			expect((await vault.read(`_hub/workspaces/${path}.md`)).content).not.toContain('aliases');
		}
		expect((await loadWorkspaces(vault)).every((w) => w.aliases.length === 0)).toBe(true);
	});

	it('reads aliases written as a list or as a single string', async () => {
		await vault.write('_hub/workspaces/kaya.md', '---\nname: Kaya\naliases:\n  - kaya\n  - "kaya thai"\n---\n');
		await vault.write('_hub/workspaces/cusina.md', '---\nname: Cusina\naliases: cusina ko\n---\n');
		await vault.write('_hub/workspaces/quiet.md', '---\nname: Quiet\n---\n');

		const loaded = await loadWorkspaces(vault);
		expect(loaded.find((w) => w.slug === 'kaya')!.aliases).toEqual(['kaya', 'kaya thai']);
		expect(loaded.find((w) => w.slug === 'cusina')!.aliases).toEqual(['cusina ko']);
		expect(loaded.find((w) => w.slug === 'quiet')!.aliases).toEqual([]);
	});

	it('never overwrites a workspace the user has edited', async () => {
		await seedWorkspaces(vault);
		const path = '_hub/workspaces/personal.md';
		const mine = '---\nname: My Personal\ncolor: "#000000"\ntag: ws/me\nfolders: [Journal]\n---\nmine\n';
		await vault.write(path, mine);

		expect(await seedWorkspaces(vault)).toEqual([]);
		expect((await vault.read(path)).content).toBe(mine);
		expect((await loadWorkspaces(vault)).find((w) => w.slug === 'personal')!.name).toBe('My Personal');
	});

	it('adds nothing to a vault that already has workspaces, even unfamiliar ones', async () => {
		await vault.write('_hub/workspaces/my-own-thing.md', '---\nname: Mine\n---\n');
		expect(await seedWorkspaces(vault)).toEqual([]);
		expect((await loadWorkspaces(vault)).map((w) => w.slug)).toEqual(['my-own-thing']);
	});

	it('survives a workspace file with nothing usable in it', async () => {
		await vault.write('_hub/workspaces/broken.md', 'no frontmatter at all');
		const loaded = await loadWorkspaces(vault);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toMatchObject({ slug: 'broken', name: 'broken', tag: 'ws/broken' });
	});

	it('parses an old file that still has a tabs: list, ignoring it', async () => {
		const old = '---\nname: Legacy\ntabs:\n  - title: Board\n    widgets: [board]\n---\n';
		await vault.write('_hub/workspaces/legacy.md', old);
		const loaded = (await loadWorkspaces(vault)).find((w) => w.slug === 'legacy')!;
		expect(loaded.name).toBe('Legacy');
		expect(loaded).not.toHaveProperty('tabs');
	});

	it('parses an old file that still has a deal pipeline stages: list, ignoring it', async () => {
		await vault.write('_hub/workspaces/pipeline.md', '---\nname: Pipeline\nstages: [new, qualifying, won]\n---\n');
		const loaded = (await loadWorkspaces(vault)).find((w) => w.slug === 'pipeline')!;
		expect(loaded.name).toBe('Pipeline');
		expect(loaded).not.toHaveProperty('stages');
	});

	it('parses an old file that still says meetings: true, ignoring it', async () => {
		await vault.write('_hub/workspaces/w.md', '---\nname: Old\nmeetings: true\n---\n');
		const loaded = (await loadWorkspaces(vault))[0];
		expect(loaded.name).toBe('Old');
		expect(loaded).not.toHaveProperty('meetings');
	});

	it.each([
		['glossary: Computer Science', 'Computer Science'],
		['glossary: "  eye2gene "', 'eye2gene'],
		['glossary:', undefined],
		['name: Quiet', undefined]
	])('reads %j as glossary %j', async (line, expected) => {
		await vault.write('_hub/workspaces/w.md', `---\n${line}\n---\n`);
		expect((await loadWorkspaces(vault))[0].glossary).toBe(expected);
	});

});

describe('workspaceFor', () => {
	const ws = (slug: string, tag: string, folders: string[], aliases: string[] = []): Workspace => ({
		slug,
		name: slug,
		color: '#000',
		tag,
		aliases,
		folders,
		path: `_hub/workspaces/${slug}.md`
	});
	const all = [ws('client', 'ws/client', ['Work/Client']), ws('work', 'ws/work', ['Work'])];

	it('prefers an explicit tag over the folder', () => {
		const found = workspaceFor(all, { path: 'Work/Client/Handbook.md', tags: ['ws/work'] });
		expect(found?.slug).toBe('work');
	});

	it('falls back to the deepest matching folder', () => {
		expect(workspaceFor(all, { path: 'Work/Client/Handbook.md' })?.slug).toBe('client');
		expect(workspaceFor(all, { path: 'Work/CV.md' })?.slug).toBe('work');
	});

	it('honours a workspace field in frontmatter last', () => {
		expect(workspaceFor(all, { path: 'Inbox/x.md', frontmatter: { workspace: 'client' } })?.slug).toBe('client');
	});

	it('returns null rather than guessing for an unassigned note', () => {
		expect(workspaceFor(all, { path: 'Journal/2026/09/21.md' })).toBeNull();
	});
});

describe('workspaceFor, by alias', () => {
	const ws = (slug: string, folders: string[], aliases: string[]): Workspace => ({
		slug,
		name: slug,
		color: '#000',
		tag: `ws/${slug}`,
		aliases,
		folders,
		path: `_hub/workspaces/${slug}.md`
	});
	const kaya = ws('kaya', ['Kaya Thai'], ['Kaya', 'kaya thai therapy']);
	const cusina = ws('cusina-ko', ['Restaurant'], ['cusina ko', 'cusina']);
	const personal = ws('personal', ['Inbox'], ['personal']);
	const all = [kaya, cusina, personal];
	const DAY = 'Journal/2026/09/21.md';

	it('claims a daily block that names the workspace in its words', () => {
		expect(workspaceFor(all, { path: DAY, text: 'Work on Kaya `Q1`' })?.slug).toBe('kaya');
	});

	it('matches whole words only, so Kaya is not Kayak', () => {
		expect(workspaceFor(all, { path: DAY, text: 'Buy a kayak `Q3`' })).toBeNull();
		expect(workspaceFor(all, { path: DAY, text: 'Read okaya' })).toBeNull();
		expect(workspaceFor(all, { path: DAY, text: "Kaya's accounts" })?.slug).toBe('kaya');
	});

	it('matches a multi-word alias, and ignores case', () => {
		expect(workspaceFor(all, { path: DAY, text: 'Work on Filipino Cusina Ko' })?.slug).toBe('cusina-ko');
		expect(workspaceFor(all, { path: DAY, text: 'KAYA THAI THERAPY invoices' })?.slug).toBe('kaya');
	});

	it('reads through the markdown a task line is written in', () => {
		expect(workspaceFor(all, { path: DAY, text: '**Cusina Ko:** order the menus' })?.slug).toBe('cusina-ko');
		expect(workspaceFor(all, { path: DAY, text: 'Ring [[Kaya]] about the room' })?.slug).toBe('kaya');
		// The alias a wikilink displays is what a reader sees, so it is what is
		// matched: `[[Kaya|the studio]]` reads as "the studio" and claims nothing.
		expect(workspaceFor(all, { path: DAY, text: 'Ring [[Kaya|the studio]]' })).toBeNull();
	});

	it('treats a metacharacter in an alias as a character', () => {
		const odd = [ws('lang', [], ['c++']), ws('any', [], ['a.c'])];
		expect(workspaceFor(odd, { path: DAY, text: 'Revise c++ templates' })?.slug).toBe('lang');
		expect(workspaceFor(odd, { path: DAY, text: 'Revise cxx templates' })).toBeNull();
		expect(workspaceFor(odd, { path: DAY, text: 'Open abc' })).toBeNull();
		expect(workspaceFor(odd, { path: DAY, text: 'Open a.c' })?.slug).toBe('any');
	});

	it('is tried last: a tag and a folder both beat it', () => {
		expect(workspaceFor(all, { path: DAY, tags: ['ws/personal'], text: 'Work on Kaya' })?.slug).toBe('personal');
		expect(workspaceFor(all, { path: 'Inbox/notes.md', text: 'Work on Kaya' })?.slug).toBe('personal');
		expect(
			workspaceFor(all, { path: 'Somewhere/else.md', frontmatter: { workspace: 'personal' }, text: 'Work on Kaya' })
				?.slug
		).toBe('personal');
	});

	it('never guesses when the caller passes no text', () => {
		expect(workspaceFor(all, { path: DAY })).toBeNull();
		expect(workspaceFor(all, { path: DAY, text: 'Write the daily log' })).toBeNull();
	});
});

describe('createWorkspace', () => {
	it('writes a workspace file with a name, colour and folders, and no tabs: or template: field', async () => {
		const created = await createWorkspace(vault, { name: 'Riverside Clinic', color: '#123456', folders: ['Work/Riverside'] });
		if (!created.ok) throw new Error('expected the workspace to be created');
		expect(created.workspace).toMatchObject({
			slug: 'riverside-clinic',
			name: 'Riverside Clinic',
			color: '#123456',
			tag: 'ws/riverside-clinic',
			folders: ['Work/Riverside']
		});

		const content = (await vault.read(created.workspace.path)).content;
		expect(content).not.toContain('tabs:');
		expect(content).not.toContain('template:');

		const loaded = (await loadWorkspaces(vault)).find((w) => w.slug === 'riverside-clinic')!;
		expect(loaded.folders).toEqual(['Work/Riverside']);
	});

	it('writes template: when asked for one', async () => {
		const created = await createWorkspace(vault, { name: 'Filipino', folders: ['Study/Filipino'], template: 'study' });
		if (!created.ok) throw new Error('expected the workspace to be created');
		expect(created.workspace).toMatchObject({ slug: 'filipino', template: 'study', folders: ['Study/Filipino'] });
		expect((await vault.read(created.workspace.path)).content).toContain('\ntemplate: study\nfolders:\n  - "Study/Filipino"\n');
	});

	it('refuses rather than overwrites a taken slug', async () => {
		await createWorkspace(vault, { name: 'Atlas' });
		const again = await createWorkspace(vault, { name: 'Atlas' });
		expect(again).toEqual({ ok: false, reason: 'exists' });
	});
});

describe('setReferenceFolders', () => {
	const FILE = `---
name: CS study
# the subject's home comes first
tag: ws/cs-study
template: study
folders:
  - "Study/Computer Science"
  - "Computer Science"
tabs:
  - title: Overview
---

Notes about the subject.
`;

	async function cs(content = FILE): Promise<Workspace> {
		await vault.write('_hub/workspaces/cs-study.md', content);
		return (await loadWorkspaces(vault)).find((w) => w.slug === 'cs-study')!;
	}

	it('replaces only the folders: lines, keeping the home first and every other byte', async () => {
		const result = await setReferenceFolders(vault, await cs(), ['Computer Science', 'Papers/ML']);
		expect(result).toEqual({ ok: true, path: '_hub/workspaces/cs-study.md' });
		const content = (await vault.read('_hub/workspaces/cs-study.md')).content;
		expect(content).toBe(FILE.replace('  - "Computer Science"\n', '  - Computer Science\n  - Papers/ML\n').replace('  - "Study/Computer Science"', '  - Study/Computer Science'));
		expect((await loadWorkspaces(vault)).find((w) => w.slug === 'cs-study')!.folders).toEqual(['Study/Computer Science', 'Computer Science', 'Papers/ML']);
	});

	it.each([
		['an empty list leaves only the home', [], ['Study/Computer Science']],
		['typed paths are tidied', [' /Papers/ML/ ', 'Papers\\\\Vision', 'a//b'], ['Study/Computer Science', 'Papers/ML', 'Papers/Vision', 'a/b']],
		['repeats, empties and the home itself are dropped', ['X', '', 'X', 'Study/Computer Science'], ['Study/Computer Science', 'X']]
	])('%s', async (_, refs, folders) => {
		await setReferenceFolders(vault, await cs(), refs);
		expect((await loadWorkspaces(vault)).find((w) => w.slug === 'cs-study')!.folders).toEqual(folders);
	});

	it('makes the first folder the home of a workspace that names none', async () => {
		const bare = await cs('---\nname: CS study\n---\n');
		await setReferenceFolders(vault, bare, ['Computer Science', 'Papers']);
		expect((await vault.read(bare.path)).content).toBe('---\nname: CS study\nfolders:\n  - Computer Science\n  - Papers\n---\n');
	});

	it('refuses a path that climbs out, and writes nothing', async () => {
		const ws = await cs();
		const result = await setReferenceFolders(vault, ws, ['../Private']);
		expect(result).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read(ws.path)).content).toBe(FILE);
	});

	it('reports a definition that has gone', async () => {
		const ws = await cs();
		await vault.remove(ws.path);
		expect(await setReferenceFolders(vault, ws, ['X'])).toMatchObject({ ok: false, reason: 'not-found' });
	});
});

describe('deleteWorkspace', () => {
	it('removes only the definition file, leaving the workspace\'s notes where they are', async () => {
		await createWorkspace(vault, { name: 'Side projects', folders: ['Writing'] });
		await vault.write('Writing/Draft.md', '# Draft\n');
		await vault.write('Writing/Board.md', '## To do\n');

		expect(await deleteWorkspace(vault, 'side-projects')).toEqual({ ok: true });
		expect((await loadWorkspaces(vault)).map((w) => w.slug)).not.toContain('side-projects');
		expect((await vault.read('Writing/Draft.md')).exists).toBe(true);
		expect((await vault.read('Writing/Board.md')).exists).toBe(true);
	});

	it('refuses an unknown slug and anything shaped like a path', async () => {
		await vault.write('Other/x.md', 'keep');
		expect(await deleteWorkspace(vault, 'nope')).toEqual({ ok: false, reason: 'not-found' });
		expect(await deleteWorkspace(vault, '../Other/x')).toEqual({ ok: false, reason: 'not-found' });
		expect((await vault.read('Other/x.md')).exists).toBe(true);
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { createWorkspace, loadWorkspaces, seedWorkspaces, workspaceFor, TEMPLATE_TABS, type Workspace } from './workspaces';

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
		expect(work.tabs[0]).toEqual({ title: 'Overview', widgets: ['board', 'time'] });
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
		expect(loaded[0]).toMatchObject({ slug: 'broken', name: 'broken', tag: 'ws/broken', tabs: [] });
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
		deck: 'Inbox/Tasks.md',
		kanbanColumns: [],
		template: 'project',
		tabs: [],
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
		deck: 'Inbox/Tasks.md',
		kanbanColumns: [],
		template: 'project',
		tabs: [],
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

describe('TEMPLATE_TABS', () => {
	it('starts a project and a business workspace with an Overview of the board and time', () => {
		expect(TEMPLATE_TABS.project[0]).toEqual({ title: 'Overview', widgets: ['board', 'time'] });
		expect(TEMPLATE_TABS.business[0]).toEqual({ title: 'Overview', widgets: ['board', 'time'] });
	});

	it('leaves the other five tabs on both templates as they were', () => {
		expect(TEMPLATE_TABS.project.slice(1).map((t) => t.title)).toEqual(['Notes', 'People', 'Blocked', 'Insights']);
		expect(TEMPLATE_TABS.business.slice(1).map((t) => t.title)).toEqual(['Notes', 'People', 'Blocked', 'Insights']);
	});
});

describe('createWorkspace', () => {
	it('writes the Overview tab onto a project workspace', async () => {
		const created = await createWorkspace(vault, { name: 'Riverside Clinic', template: 'project' });
		if (!created.ok) throw new Error('expected the workspace to be created');
		expect(created.workspace.tabs).toEqual(TEMPLATE_TABS.project);

		const loaded = (await loadWorkspaces(vault)).find((w) => w.slug === 'riverside-clinic')!;
		expect(loaded.tabs).toEqual(TEMPLATE_TABS.project);
	});

	it('writes the Overview tab onto a business workspace', async () => {
		const created = await createWorkspace(vault, { name: 'Riverside Clinic', template: 'business' });
		if (!created.ok) throw new Error('expected the workspace to be created');
		expect(created.workspace.tabs).toEqual(TEMPLATE_TABS.business);
	});
});

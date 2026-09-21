import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { loadWorkspaces, seedWorkspaces, workspaceFor, type Workspace } from './workspaces';

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
		expect(work.tabs[0]).toEqual({ title: 'Board', widgets: ['board'] });
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
	const ws = (slug: string, tag: string, folders: string[]): Workspace => ({
		slug,
		name: slug,
		color: '#000',
		tag,
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

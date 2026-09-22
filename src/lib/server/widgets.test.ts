import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { NoteIndex } from './index/index';
import { tabCounts, type WidgetContext } from './widgets';
import type { Workspace } from './workspaces';

/**
 * `tabCounts` is the one thing the tab bar needs before any widget on the
 * page has otherwise loaded, so these tests go straight at the catalogue's
 * real widgets rather than a stub: `board` counts, `notes` does not, and
 * neither an unknown name nor a broken index may turn into an error page.
 */

function workspace(fields: Partial<Workspace> = {}): Workspace {
	return {
		slug: 'work',
		name: 'Work',
		color: '#2f6fed',
		tag: 'ws/work',
		aliases: [],
		folders: ['Work'],
		template: 'project',
		tabs: [],
		deck: 'Work/Tasks.md',
		kanbanColumns: [],
		path: '_hub/workspaces/work.md',
		...fields
	};
}

let root: string;
let vault: Vault;
let index: NoteIndex;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-widgets-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
});
afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

function context(overrides: Partial<WidgetContext> = {}): WidgetContext {
	const ws = workspace();
	return { index, vault, workspace: ws, workspaces: [ws], today: '2026-09-22', ...overrides };
}

describe('tabCounts', () => {
	it('counts a tab by its first widget that exports count', async () => {
		index.put('Work/Tasks.md', ['# Work', '- [ ] Ship it `Q1`', '- [ ] Ship it too `Q2`', ''].join('\n'));

		const [count] = await tabCounts([{ title: 'Overview', widgets: ['board', 'time'] }], context());
		expect(count).toBe(2);
	});

	it('is null for a tab whose widget does not export count', async () => {
		const [count] = await tabCounts([{ title: 'Notes', widgets: ['notes'] }], context());
		expect(count).toBeNull();
	});

	it('is null for an unknown widget name', async () => {
		const [count] = await tabCounts([{ title: 'Mystery', widgets: ['not-a-real-widget'] }], context());
		expect(count).toBeNull();
	});

	it('is null when the counting widget throws, rather than failing the page', async () => {
		const broken = {
			findTasks() {
				throw new Error('boom');
			}
		} as unknown as NoteIndex;

		const [count] = await tabCounts([{ title: 'Overview', widgets: ['board'] }], context({ index: broken }));
		expect(count).toBeNull();
	});
});

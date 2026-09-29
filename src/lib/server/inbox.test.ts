import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { fileInboxLine, listInboxLines, openInboxCount } from './inbox';
import type { Workspace } from './workspaces';

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-inbox-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('fileInboxLine', () => {
	const WORK: Workspace = {
		slug: 'work',
		name: 'Work',
		color: '#2e6b85',
		tag: 'ws/work',
		aliases: [],
		folders: ['Work'],
		path: '_hub/workspaces/work.md'
	};
	const board = async () => (await vault.read('Work/Board.md')).content;

	it('adds a plain captured bullet to the first column, without its capture time, and ticks it in the inbox', async () => {
		await vault.write('Work/Inbox.md', '# Inbox\n\n## 2026-09-29\n- 09:00 Call the supplier\n');
		const result = await fileInboxLine(vault, WORK, 3, '- 09:00 Call the supplier');
		expect(result).toEqual({ ok: true, path: 'Work/Board.md' });

		expect(await board()).toMatch(/## To do\n\n- \[ \] Call the supplier\n/);
		expect((await vault.read('Work/Inbox.md')).content).toContain('- [x] 09:00 Call the supplier');
	});

	it('reads the words the way quick-add does, and ticks a task line through the task rewriter', async () => {
		await vault.write('Work/Inbox.md', '# Inbox\n\n## 2026-09-29\n- [ ] Buy milk `Q3`\n');
		await fileInboxLine(vault, WORK, 3, '- [ ] Buy milk `Q3`');
		expect((await vault.read('Work/Inbox.md')).content).toContain('- [x] Buy milk `Q3`');
		expect(await board()).toContain('- [ ] Buy milk `Q3`');
	});

	it('adds to the end of an existing first column and leaves the rest of the board alone', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 First\n');
		const before = '---\n\nkanban-plugin: board\n\n---\n\n## Next\n\n- [ ] Already there\n\n## Later\n\n- [ ] Someday\n';
		await vault.write('Work/Board.md', before);
		await fileInboxLine(vault, WORK, 0, '- 09:00 First');
		expect(await board()).toBe(before.replace('- [ ] Already there\n', '- [ ] Already there\n- [ ] First\n'));
	});

	it('never deletes the inbox line, only ticks it', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 Keep me\n');
		await fileInboxLine(vault, WORK, 0, '- 09:00 Keep me');
		expect((await vault.read('Work/Inbox.md')).content).toContain('Keep me');
	});

	it('refuses when the inbox line changed underneath, and writes no board', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 Original\n');
		const result = await fileInboxLine(vault, WORK, 0, '- 09:00 Stale');
		expect(result).toEqual({ ok: false, reason: 'line-changed' });
		expect((await vault.read('Work/Board.md')).exists).toBe(false);
	});

	it('reports no-note for an inbox that does not exist', async () => {
		const result = await fileInboxLine(vault, WORK, 0, '- x');
		expect(result).toEqual({ ok: false, reason: 'no-note' });
	});

	it('refuses a bullet with no words rather than filing an empty card', async () => {
		await vault.write('Work/Inbox.md', '-   \n');
		const result = await fileInboxLine(vault, WORK, 0, '-   ');
		expect(result).toEqual({ ok: false, reason: 'no-text' });
	});
});

describe('openInboxCount', () => {
	it('counts a plain captured bullet and an open task, but not a ticked line', async () => {
		const content = ['# Inbox', '', '## 2026-09-29', '- 09:00 Plain capture', '- [ ] An open task', '- [x] 08:00 Already filed'].join('\n');
		expect(openInboxCount(content)).toBe(2);
	});

	it('is zero for an inbox with nothing but headings', async () => {
		expect(openInboxCount('# Inbox\n\n## 2026-09-29\n')).toBe(0);
	});
});

describe('listInboxLines', () => {
	it('reads a plain capture and an open task, in file order', () => {
		const content = ['# Inbox', '', '## 2026-09-29', '- 09:00 Plain capture', '- [ ] An open task `Q1`'].join('\n');
		const lines = listInboxLines(content, 'Work/Inbox.md');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ line: 3, task: null, done: false, text: '09:00 Plain capture' });
		expect(lines[1].task).not.toBeNull();
		expect(lines[1].done).toBe(false);
		expect(lines[1].text).toBe('An open task');
	});

	it('reads a ticked line as done', () => {
		const lines = listInboxLines('- [x] 08:00 Already filed', 'Work/Inbox.md');
		expect(lines[0].done).toBe(true);
	});

	it('skips headings and blank lines', () => {
		expect(listInboxLines('# Inbox\n\n## 2026-09-29\n', 'Work/Inbox.md')).toEqual([]);
	});
});

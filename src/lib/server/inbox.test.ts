import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { fileInboxLine, listInboxLines, openInboxCount } from './inbox';

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
	it('appends a plain captured bullet to Tasks.md and ticks it in the inbox', async () => {
		await vault.write('Work/Inbox.md', '# Inbox\n\n## 2026-09-29\n- 09:00 Call the supplier\n');
		const result = await fileInboxLine(vault, 'Work/Inbox.md', 3, '- 09:00 Call the supplier', 'Work/Tasks.md');
		expect(result).toEqual({ ok: true, path: 'Work/Tasks.md' });

		expect((await vault.read('Work/Tasks.md')).content).toBe('# Tasks\n- [ ] 09:00 Call the supplier\n');
		expect((await vault.read('Work/Inbox.md')).content).toContain('- [x] 09:00 Call the supplier');
	});

	it('ticks an inbox line already written as a task, through the task rewriter', async () => {
		await vault.write('Work/Inbox.md', '# Inbox\n\n## 2026-09-29\n- [ ] Buy milk `Q3`\n');
		await fileInboxLine(vault, 'Work/Inbox.md', 3, "- [ ] Buy milk `Q3`", 'Work/Tasks.md');
		expect((await vault.read('Work/Inbox.md')).content).toContain('- [x] Buy milk `Q3`');
		expect((await vault.read('Work/Tasks.md')).content).toContain('- [ ] Buy milk `Q3`');
	});

	it('appends under an existing # Tasks heading rather than duplicating it', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 First\n- 10:00 Second\n');
		await vault.write('Work/Tasks.md', '# Tasks\n- [ ] Already there\n');
		await fileInboxLine(vault, 'Work/Inbox.md', 0, '- 09:00 First', 'Work/Tasks.md');
		expect((await vault.read('Work/Tasks.md')).content).toBe('# Tasks\n- [ ] Already there\n- [ ] 09:00 First\n');
	});

	it('never deletes the inbox line, only ticks it', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 Keep me\n');
		await fileInboxLine(vault, 'Work/Inbox.md', 0, '- 09:00 Keep me', 'Work/Tasks.md');
		expect((await vault.read('Work/Inbox.md')).content).toContain('Keep me');
	});

	it('refuses when the inbox line changed underneath', async () => {
		await vault.write('Work/Inbox.md', '- 09:00 Original\n');
		const result = await fileInboxLine(vault, 'Work/Inbox.md', 0, '- 09:00 Stale', 'Work/Tasks.md');
		expect(result).toEqual({ ok: false, reason: 'line-changed' });
		expect((await vault.read('Work/Tasks.md')).exists).toBe(false);
	});

	it('reports no-note for an inbox that does not exist', async () => {
		const result = await fileInboxLine(vault, 'Work/Inbox.md', 0, '- x', 'Work/Tasks.md');
		expect(result).toEqual({ ok: false, reason: 'no-note' });
	});

	it('refuses a bullet with no words rather than filing an empty task', async () => {
		await vault.write('Work/Inbox.md', '-   \n');
		const result = await fileInboxLine(vault, 'Work/Inbox.md', 0, '-   ', 'Work/Tasks.md');
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

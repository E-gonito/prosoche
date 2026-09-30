import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { belongsTo, dropInboxLine, fileInboxLine, legacyInbox, listInboxLines, planInboxLine, unfiled } from './inbox';
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
		await vault.write('Inbox/Capture.md', '# Inbox\n\n## 2026-09-29\n- 09:00 Call the supplier\n');
		const result = await fileInboxLine(vault, WORK, 3, '- 09:00 Call the supplier');
		expect(result).toEqual({ ok: true, path: 'Work/Board.md' });

		expect(await board()).toMatch(/## To do\n\n- \[ \] Call the supplier\n/);
		expect((await vault.read('Inbox/Capture.md')).content).toContain('- [x] 09:00 Call the supplier');
	});

	it('reads the words the way quick-add does, and ticks a task line through the task rewriter', async () => {
		await vault.write('Inbox/Capture.md', '# Inbox\n\n## 2026-09-29\n- [ ] Buy milk `Q3`\n');
		await fileInboxLine(vault, WORK, 3, '- [ ] Buy milk `Q3`');
		expect((await vault.read('Inbox/Capture.md')).content).toContain('- [x] Buy milk `Q3`');
		expect(await board()).toContain('- [ ] Buy milk `Q3`');
	});

	it('adds to the end of an existing first column and leaves the rest of the board alone', async () => {
		await vault.write('Inbox/Capture.md', '- 09:00 First\n');
		const before = '---\n\nkanban-plugin: board\n\n---\n\n## Next\n\n- [ ] Already there\n\n## Later\n\n- [ ] Someday\n';
		await vault.write('Work/Board.md', before);
		await fileInboxLine(vault, WORK, 0, '- 09:00 First');
		expect(await board()).toBe(before.replace('- [ ] Already there\n', '- [ ] Already there\n- [ ] First\n'));
	});

	it("leaves the workspace's own tag off its card", async () => {
		await vault.write('Inbox/Capture.md', '- 09:00 Call the printer #ws/work\n');
		await fileInboxLine(vault, WORK, 0, '- 09:00 Call the printer #ws/work');
		expect(await board()).toMatch(/## To do\n\n- \[ \] Call the printer\n/);
	});

	it('never deletes the inbox line, only ticks it', async () => {
		await vault.write('Inbox/Capture.md', '- 09:00 Keep me\n');
		await fileInboxLine(vault, WORK, 0, '- 09:00 Keep me');
		expect((await vault.read('Inbox/Capture.md')).content).toContain('Keep me');
	});

	it('refuses when the inbox line changed underneath, and writes no board', async () => {
		await vault.write('Inbox/Capture.md', '- 09:00 Original\n');
		const result = await fileInboxLine(vault, WORK, 0, '- 09:00 Stale');
		expect(result).toEqual({ ok: false, reason: 'line-changed' });
		expect((await vault.read('Work/Board.md')).exists).toBe(false);
	});

	it('reports no-note for an inbox that does not exist', async () => {
		const result = await fileInboxLine(vault, WORK, 0, '- x');
		expect(result).toEqual({ ok: false, reason: 'no-note' });
	});

	it('refuses a bullet with no words rather than filing an empty card', async () => {
		await vault.write('Inbox/Capture.md', '-   \n');
		const result = await fileInboxLine(vault, WORK, 0, '-   ');
		expect(result).toEqual({ ok: false, reason: 'no-text' });
	});
});

describe('listInboxLines', () => {
	it('reads a plain capture and an open task, in file order', () => {
		const content = ['# Inbox', '', '## 2026-09-29', '- 09:00 Plain capture', '- [ ] An open task `Q1`'].join('\n');
		const lines = listInboxLines(content, 'Work/Inbox.md');
		expect(lines).toHaveLength(2);
		expect(lines[0]).toMatchObject({ line: 3, task: null, done: false, text: 'Plain capture', stamp: '09:00', day: '2026-09-29' });
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

const line = (n: number, day: string | null, done = false) => ({ line: n, raw: `- l${n}`, task: null, done, text: `l${n}`, stamp: null, day });

describe('unfiled', () => {
	const lines = [line(0, null), line(2, '2026-09-28'), line(3, '2026-09-28', true), line(4, '2026-09-28'), line(6, '2026-09-29'), line(7, '2026-09-29')];
	it('is newest day first, file order within a day, done lines out, undated last', () => {
		expect(unfiled(lines).map((l) => l.line)).toEqual([6, 7, 2, 4, 0]);
	});
	it('can be strictly newest first', () => {
		expect(unfiled(lines, { newestFirst: true }).map((l) => l.line)).toEqual([7, 6, 4, 2, 0]);
	});
});

describe('belongsTo', () => {
	const KAYA: Workspace = { slug: 'kaya', name: 'Kaya', color: '#000', tag: 'ws/kaya', aliases: ['kaya'], folders: ['Kaya'], path: '_hub/workspaces/kaya.md' };
	const WORK: Workspace = { ...KAYA, slug: 'work', name: 'Work', tag: 'ws/work', aliases: ['acme'], folders: ['Work'] };
	const all = [KAYA, WORK];
	const read = (text: string) => listInboxLines(`## 2026-09-30\n${text}`, 'Inbox/Capture.md')[0];
	it.each([
		['- 09:00 Call the printer #ws/kaya', 'kaya'],
		['- [ ] Order rice #ws/kaya `Q2`', 'kaya'],
		['- 09:00 Work on Kaya', 'kaya'],
		['- 09:00 Email acme about Kaya #ws/work', 'work'],
		['- 09:00 buy a kayak', null],
		['- 09:00 plain', null]
	])('%s is %s', (text, slug) => {
		expect(all.filter((w) => belongsTo(read(text), all, w)).map((w) => w.slug)).toEqual(slug ? [slug] : []);
	});
});

describe('the other two exits', () => {
	const DAY = '2026-09-30';
	const NOTE = 'Journal/2026/09/30.md';
	const INBOX = '# Capture\n\n## 2026-09-30\n- 09:05 Call the plumber\n- [ ] Buy milk `Q3`\n';

	it('plans a bare bullet onto the day: made a task, linked, then ticked', async () => {
		await vault.write('Inbox/Capture.md', INBOX);
		await vault.write(NOTE, '# Tasks\n- [ ] Walk\n');
		expect(await planInboxLine(vault, [], DAY, 3, '- 09:05 Call the plumber')).toEqual({ ok: true, path: NOTE });
		expect((await vault.read(NOTE)).content).toBe('# Tasks\n- [ ] Walk\n- [ ] Call the plumber [[Inbox/Capture]]\n');
		expect((await vault.read('Inbox/Capture.md')).content).toBe(INBOX.replace('- 09:05 Call', '- [x] 09:05 Call'));
	});

	it('plans a task line as it is, and ticks it', async () => {
		await vault.write('Inbox/Capture.md', INBOX);
		await vault.write(NOTE, '# Tasks\n');
		await planInboxLine(vault, [], DAY, 4, '- [ ] Buy milk `Q3`');
		expect((await vault.read(NOTE)).content).toBe('# Tasks\n- [ ] Buy milk [[Inbox/Capture]] `Q3`\n');
		expect((await vault.read('Inbox/Capture.md')).content).toBe(INBOX.replace('- [ ] Buy', '- [x] Buy'));
	});

	it('refuses to plan onto a day with no note, and writes nothing', async () => {
		await vault.write('Inbox/Capture.md', INBOX);
		expect(await planInboxLine(vault, [], DAY, 3, '- 09:05 Call the plumber')).toEqual({ ok: false, reason: 'no-day' });
		expect((await vault.read('Inbox/Capture.md')).content).toBe(INBOX);
		expect((await vault.read(NOTE)).exists).toBe(false);
	});

	it('drops a line by ticking it, and refuses a stale one', async () => {
		await vault.write('Inbox/Capture.md', INBOX);
		expect(await dropInboxLine(vault, 3, '- 09:05 Stale')).toEqual({ ok: false, reason: 'line-changed' });
		expect(await dropInboxLine(vault, 3, '- 09:05 Call the plumber')).toEqual({ ok: true, path: 'Inbox/Capture.md' });
		expect((await vault.read('Inbox/Capture.md')).content).toBe(INBOX.replace('- 09:05 Call', '- [x] 09:05 Call'));
	});

	it("lists a workspace's old Inbox.md, open lines only", async () => {
		const WORK: Workspace = { slug: 'work', name: 'Work', color: '#000', tag: 'ws/work', aliases: [], folders: ['Work'], path: '_hub/workspaces/work.md' };
		await vault.write('Work/Inbox.md', '- [x] done\n- 08:00 still here\n');
		expect(await legacyInbox(vault, WORK)).toMatchObject({ path: 'Work/Inbox.md', lines: [{ line: 1, text: 'still here', stamp: '08:00' }] });
	});
});

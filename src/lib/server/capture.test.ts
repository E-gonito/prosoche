import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { appendUnderDay, capture, routeCapture } from './capture';
import type { Workspace } from './workspaces';

describe('appendUnderDay', () => {
	it('creates the day heading on a fresh file', () => {
		expect(appendUnderDay('# Capture\n', 'call the plumber', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 14:05 call the plumber\n'
		);
	});

	it('appends under an existing day', () => {
		const before = '# Capture\n\n## 2026-09-21\n- 09:00 first\n';
		expect(appendUnderDay(before, 'second', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 09:00 first\n- 14:05 second\n'
		);
	});

	it('does not leak into the next day\'s section', () => {
		const before = '# Capture\n\n## 2026-09-21\n- 09:00 first\n\n## 2026-09-20\n- 10:00 older\n';
		expect(appendUnderDay(before, 'second', '2026-09-21', '14:05')).toBe(
			'# Capture\n\n## 2026-09-21\n- 09:00 first\n- 14:05 second\n\n## 2026-09-20\n- 10:00 older\n'
		);
	});

	it('keeps something already written as a task a task', () => {
		expect(appendUnderDay('# Capture\n', '- [ ] Buy milk `Q3`', '2026-09-21', '14:05')).toContain(
			'- [ ] Buy milk `Q3`'
		);
	});

	it('adds a new day above older ones without disturbing them', () => {
		const before = '# Capture\n\n## 2026-09-20\n- 10:00 older\n';
		const after = appendUnderDay(before, 'new thing', '2026-09-21', '08:00');
		expect(after).toContain('## 2026-09-20\n- 10:00 older');
		expect(after).toContain('## 2026-09-21\n- 08:00 new thing');
	});
});

const KAYA: Workspace = {
	slug: 'kaya',
	name: 'Kaya',
	color: '#c2553f',
	tag: 'ws/kaya',
	aliases: ['kaya'],
	folders: ['Projects/Kaya'],
	path: '_hub/workspaces/kaya.md'
};
const E2G: Workspace = { ...KAYA, slug: 'eye2gene', name: 'eye2gene', tag: 'ws/eye2gene', aliases: ['eye2gene', 'e2g'], folders: ['Inbox'], path: '_hub/workspaces/eye2gene.md' };
const ALL = [KAYA, E2G];
const DAY = '2026-09-30';

describe('routeCapture', () => {
	it.each<[string, string, ReturnType<typeof routeCapture>]>([
		['a time range goes to the day', '10:00 - 11:00 Dentist', { to: 'day', line: '- [ ] 10:00 - 11:00 Dentist', startMin: 600, endMin: 660 }],
		['a timed task line keeps its checkbox', '- [ ] 9:30 - 10:00 Stretch `Q1`', { to: 'day', line: '- [ ] 9:30 - 10:00 Stretch `Q1`', startMin: 570, endMin: 600 }],
		['a time wins over a tag', '14:00 - 14:30 Call #ws/kaya', { to: 'day', line: '- [ ] 14:00 - 14:30 Call #ws/kaya', startMin: 840, endMin: 870 }],
		['a lone time is only words', '09:00 call the plumber', { to: 'inbox', text: '09:00 call the plumber' }],
		['a workspace tag goes to its board, the tag taken out', 'Order menus #ws/kaya fri', { to: 'board', workspace: KAYA, text: 'Order menus fri' }],
		['an alias word goes to its board', 'Work on Kaya Q1', { to: 'board', workspace: KAYA, text: 'Work on Kaya Q1' }],
		['a second alias works too', 'send the e2g deck', { to: 'board', workspace: E2G, text: 'send the e2g deck' }],
		['a task line is read without its checkbox', '- [ ] Buy rice #ws/kaya `Q2`', { to: 'board', workspace: KAYA, text: 'Buy rice `Q2`' }],
		['an alias inside a word does not count', 'buy a kayak', { to: 'inbox', text: 'buy a kayak' }],
		['a bare tag with no words stays in the inbox', '#ws/kaya', { to: 'inbox', text: '#ws/kaya' }],
		['a workspace folder named Inbox claims nothing', 'plain thought', { to: 'inbox', text: 'plain thought' }]
	])('%s', (_name, text, want) => {
		expect(routeCapture(text, ALL, { day: DAY })).toEqual(want);
	});

	it("the box on a day's Unscheduled list sends everything to that day, timed or not", () => {
		expect(routeCapture('buy stamps', ALL, { day: DAY, toDay: true })).toEqual({ to: 'day', line: '- [ ] buy stamps', startMin: null, endMin: null });
		expect(routeCapture('10:00 - 10:30 Dentist', ALL, { day: DAY, toDay: true })).toEqual({ to: 'day', line: '- [ ] 10:00 - 10:30 Dentist', startMin: 600, endMin: 630 });
		// A workspace tag stays on the line: on a daily task it is the workspace membership.
		expect(routeCapture('Order menus #ws/kaya', ALL, { day: DAY, toDay: true })).toEqual({ to: 'day', line: '- [ ] Order menus #ws/kaya', startMin: null, endMin: null });
		expect(routeCapture('- [x] done already', ALL, { day: DAY, toDay: true })).toEqual({ to: 'day', line: '- [x] done already', startMin: null, endMin: null });
	});

	it("a workspace's own box tags the inbox line instead of filing it", () => {
		expect(routeCapture('Call the printer', ALL, { day: DAY, workspace: KAYA })).toEqual({ to: 'inbox', text: 'Call the printer #ws/kaya' });
		expect(routeCapture('Call #ws/kaya', ALL, { day: DAY, workspace: KAYA })).toEqual({ to: 'inbox', text: 'Call #ws/kaya' });
		expect(routeCapture('10:00 - 10:30 Printer', ALL, { day: DAY, workspace: KAYA })).toMatchObject({ to: 'day', line: '- [ ] 10:00 - 10:30 Printer #ws/kaya' });
	});
});

describe('capture', () => {
	let root: string;
	let vault: Vault;
	const now = new Date(2026, 8, 30, 8, 15);
	const NOTE = 'Journal/2026/09/30.md';
	const BOARD = 'Projects/Kaya/Board.md';
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-capture-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});
	const read = async (path: string) => (await vault.read(path)).content;

	it('puts a timed line in today\'s note and nowhere else', async () => {
		await vault.write(NOTE, '# Tasks\n- [ ] Walk\n');
		expect(await capture(vault, ALL, '10:00 - 11:00 Dentist', { now })).toEqual({ path: NOTE, to: 'day', message: 'Added to today, 10:00–11:00' });
		expect(await read(NOTE)).toBe('# Tasks\n- [ ] Walk\n- [ ] 10:00 - 11:00 Dentist\n');
		expect((await vault.read('Inbox/Capture.md')).exists).toBe(false);
	});

	it('falls back to the inbox when today has no note, and never creates one', async () => {
		const result = await capture(vault, ALL, '10:00 - 11:00 Dentist', { now });
		expect(result).toMatchObject({ path: 'Inbox/Capture.md', to: 'inbox' });
		expect((await vault.read(NOTE)).exists).toBe(false);
		expect(await read('Inbox/Capture.md')).toBe('# Capture\n\n## 2026-09-30\n- [ ] 10:00 - 11:00 Dentist\n');
	});

	it('files a line naming a workspace onto its board, bottom of the first column', async () => {
		await vault.write(BOARD, '---\n\nkanban-plugin: board\n\n---\n\n## To do\n\n- [ ] Old\n\n## Done\n\n');
		const result = await capture(vault, ALL, 'Order menus #ws/kaya', { now });
		expect(result).toEqual({ path: BOARD, to: 'board', message: "Added to Kaya's board" });
		expect(await read(BOARD)).toContain('- [ ] Old\n- [ ] Order menus\n');
		expect((await vault.read('Inbox/Capture.md')).exists).toBe(false);
	});

	it('keeps a line in the inbox when its workspace has no board yet', async () => {
		expect(await capture(vault, ALL, 'Work on Kaya', { now })).toMatchObject({ to: 'inbox' });
		expect((await vault.read(BOARD)).exists).toBe(false);
		expect(await read('Inbox/Capture.md')).toContain('- 08:15 Work on Kaya');
	});

	it('stamps anything else into the inbox under today', async () => {
		expect(await capture(vault, ALL, 'buy stamps', { now })).toEqual({ path: 'Inbox/Capture.md', to: 'inbox', message: 'Saved to Inbox/Capture.md' });
		expect(await read('Inbox/Capture.md')).toBe('# Capture\n\n## 2026-09-30\n- 08:15 buy stamps\n');
	});

	it("given a day, adds an untimed task to that day's note and nowhere else", async () => {
		await vault.write(NOTE, '# Tasks\n- [ ] Walk\n\n## Backlog\n');
		const result = await capture(vault, ALL, 'buy stamps', { now, day: '2026-09-30' });
		expect(result).toEqual({ path: NOTE, to: 'day', message: "Added to today's unscheduled list" });
		expect(await read(NOTE)).toBe('# Tasks\n- [ ] Walk\n- [ ] buy stamps\n\n## Backlog\n');
		expect((await vault.read('Inbox/Capture.md')).exists).toBe(false);
	});

	it('given another day, names it, and a timed line keeps its time', async () => {
		await vault.write('Journal/2026/10/01.md', '# Tasks\n');
		const result = await capture(vault, ALL, '10:00 - 10:30 Dentist', { now, day: '2026-10-01' });
		expect(result).toEqual({ path: 'Journal/2026/10/01.md', to: 'day', message: 'Added to 2026-10-01, 10:00–10:30' });
	});

	it('given a day with no note, falls back to the inbox and creates nothing', async () => {
		const result = await capture(vault, ALL, 'buy stamps', { now, day: '2026-09-30' });
		expect(result).toMatchObject({ to: 'inbox', message: 'Today has no note yet, so it went to Inbox/Capture.md' });
		expect((await vault.read(NOTE)).exists).toBe(false);
		expect(await read('Inbox/Capture.md')).toBe('# Capture\n\n## 2026-09-30\n- [ ] buy stamps\n');
	});

	it("tags a workspace box's line and leaves the workspace's own Inbox.md alone", async () => {
		await capture(vault, ALL, 'Call the printer', { now, workspace: KAYA });
		expect(await read('Inbox/Capture.md')).toContain('- 08:15 Call the printer #ws/kaya');
		expect((await vault.read('Projects/Kaya/Inbox.md')).exists).toBe(false);
	});
});

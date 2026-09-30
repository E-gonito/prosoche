import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from './index/index';
import { Vault } from './vault/index';
import { loadToday, summaryLine } from './today';
import type { Workspace } from './workspaces';

describe('summaryLine', () => {
	it.each([
		['the brief example', { done: 4, skipped: 0, open: 5, plannedMinutes: 330, events: 2, overdue: 3 }, '4 of 9 done · 5h 30m planned · 2 events · 3 overdue'],
		['a clause at zero dropped, never the task count', { done: 0, skipped: 0, open: 0, plannedMinutes: 0, events: 0, overdue: 0 }, '0 of 0 done'],
		// Skipped is owed by nobody, so it is out of the "of" and a clause of its own.
		['skipped apart from done and owed', { done: 4, skipped: 2, open: 3, plannedMinutes: 0, events: 1, overdue: 0 }, '4 of 7 done · 2 skipped · 1 event']
	])('%s', (_name, input, expected) => {
		expect(summaryLine(input)).toBe(expected);
	});
});

const STUDY: Workspace = {
	slug: 'study',
	name: 'Study',
	color: '#7c3aed',
	tag: 'ws/study',
	aliases: [],
	folders: ['Study'],
	template: 'study',
	path: '_hub/workspaces/study.md'
};
const WORK: Workspace = { ...STUDY, slug: 'work', name: 'Work', tag: 'ws/work', folders: ['Work'], template: undefined, path: '_hub/workspaces/work.md' };
const WORKSPACES = [STUDY, WORK];

const DAY = '2026-09-29';
const DAY_PATH = 'Journal/2026/09/29.md';
const FUTURE = '2026-10-01';
const FUTURE_PATH = 'Journal/2026/10/01.md';

const DAY_NOTE = ['# Tasks', '- [ ] 09:30 - 10:00 Morning stretch `Q1`', '- [ ] Walk the dog `Q1`', ''].join('\n');
const FUTURE_NOTE = ['# Tasks', '- [ ] Prep the slides `Q1`', '- [x] Already done `Q1`', ''].join('\n');
const WORK_NOTE = [
	'# Work',
	'',
	'- [ ] Overdue report `Q1` 📅 2026-09-20',
	`- [ ] Due later this week 📅 ${FUTURE}`,
	''
].join('\n');

/** Work's board: one card overdue, one due today, one later this week, one ticked. */
const BOARD = [
	'## To do',
	'',
	`- [ ] Send the invoice @{${FUTURE}}`,
	'- [ ] Due today @{2026-09-29} `Q2`',
	'- [ ] No date at all',
	'',
	'## Doing',
	'',
	'- [ ] Renew the lease @{2026-09-25} `Q1`',
	'- [x] Old and done @{2026-09-01}',
	''
].join('\n');

describe('loadToday', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-today-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write(DAY_PATH, DAY_NOTE);
		await vault.write(FUTURE_PATH, FUTURE_NOTE);
		await vault.write('Work/Tasks.md', WORK_NOTE);
		index.put(DAY_PATH, DAY_NOTE);
		index.put(FUTURE_PATH, FUTURE_NOTE);
		index.put('Work/Tasks.md', WORK_NOTE);
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	const now = () => new Date(2026, 8, 29, 9, 0, 0);

	it('splits the viewed day into scheduled and unscheduled', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.scheduled.map((t) => t.text)).toEqual(['Morning stretch']);
		expect(data.unscheduled.map((t) => t.text)).toEqual(['Walk the dog']);
		expect(data.isToday).toBe(true);
		expect(data.summary).toContain('0 of 2 done');
	});

	it('finds what is overdue as of the real today, from a workspace note', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.overdue.map((t) => t.text)).toContain('Overdue report');
		expect(data.overdue.map((t) => t.text)).not.toContain('Due later this week');
		expect(data.overdueOwners[`Work/Tasks.md:2`]?.slug).toBe('work');
	});

	it('keeps overdue anchored to the real today, not the day being viewed', async () => {
		// Viewing a day in the past does not change what counts as overdue.
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, '2026-09-15', { now: now() });
		expect(data.overdue.map((t) => t.text)).toContain('Overdue report');
	});

	it('puts a board card in Overdue once its day has passed, and counts it in the summary', async () => {
		await vault.write('Work/Board.md', BOARD);
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.overdueCards.map((c) => [c.title, c.due, c.column])).toEqual([['Renew the lease', '2026-09-25', 'Doing']]);
		expect(data.summary).toContain(`${data.overdue.length + 1} overdue`);
	});

	it('leaves a ticked card, and a card due today, out of Overdue', async () => {
		await vault.write('Work/Board.md', BOARD);
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.overdueCards.map((c) => c.title)).not.toContain('Old and done');
		expect(data.overdueCards.map((c) => c.title)).not.toContain('Due today');
	});

	it('no longer treats tagged or deck tasks as workspace cards', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.workspaces.find((w) => w.slug === 'work')?.cards ?? []).toEqual([]);
	});

	it('gives each workspace all its open cards, most urgent first, and its inbox count', async () => {
		await vault.write('Work/Board.md', BOARD);
		await vault.write('Inbox/Capture.md', '## 2026-09-29\n- [ ] Triage this #ws/work\n- [x] Already triaged #ws/work\n- 09:00 Someone else\n');
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		const work = data.workspaces.find((w) => w.slug === 'work');
		expect(work?.inboxCount).toBe(1);
		expect(work?.cards.map((c) => c.title)).toEqual(['Renew the lease', 'Due today', 'Send the invoice', 'No date at all']);
	});

	it('reads the inbox newest first, capped at five, and hides nothing it counts', async () => {
		const lines = ['## 2026-09-28', '- 08:00 oldest', '- [x] 08:05 filed', '## 2026-09-29', ...[1, 2, 3, 4, 5].map((n) => `- 09:0${n} capture ${n}`)];
		await vault.write('Inbox/Capture.md', lines.join('\n'));
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.inbox.count).toBe(6);
		expect(data.inbox.lines.map((l) => l.text)).toEqual(['capture 5', 'capture 4', 'capture 3', 'capture 2', 'capture 1']);
	});


	it('counts a skipped task apart, in the counts and the summary', async () => {
		index.put(DAY_PATH, DAY_NOTE.replace('- [ ] Walk', '- [-] Walk'));
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.counts).toEqual({ done: 0, skipped: 1, open: 1 });
		expect(data.summary).toMatch(/^0 of 1 done · 1 skipped/);
	});

	it.each([
		['today in the morning', DAY, new Date(2026, 8, 29, 17, 59), false],
		['today from six in the evening', DAY, new Date(2026, 8, 29, 18, 0), true],
		['a past day, at any hour', DAY, new Date(2026, 8, 30, 8, 0), true],
		['a day still ahead', FUTURE, new Date(2026, 8, 29, 20, 0), false],
		['a past day with no note', '2026-09-20', new Date(2026, 8, 29, 20, 0), false]
	])('offers the review on %s', async (_name, day, at, offered) => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, day, { now: at });
		expect(data.offerReview).toBe(offered);
	});

	it('reads a missing inbox as empty', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.inbox).toEqual({ count: 0, lines: [] });
	});

	it('reads the calendar as not configured without failing the page', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.events).toEqual([]);
		expect(data.calendarProblem).toBeNull();
	});
});

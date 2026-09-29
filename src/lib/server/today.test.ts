import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from './index/index';
import { Vault } from './vault/index';
import { loadToday, restOfWeek, summaryLine } from './today';
import type { Workspace } from './workspaces';

describe('restOfWeek', () => {
	it('runs to the coming Sunday, padded to six days when the week is short', () => {
		// Tuesday: three days to Sunday, padded to six.
		expect(restOfWeek('2026-09-29')).toEqual([
			'2026-09-30',
			'2026-10-01',
			'2026-10-02',
			'2026-10-03',
			'2026-10-04',
			'2026-10-05'
		]);
	});

	it('is not padded when the natural week is already six days or more', () => {
		// Sunday: the coming Sunday is next week's, seven days out.
		expect(restOfWeek('2026-10-04')).toHaveLength(7);
		expect(restOfWeek('2026-10-04')[6]).toBe('2026-10-11');
	});

	it('never returns today itself, or fewer than six days', () => {
		for (const day of ['2026-09-28', '2026-10-02', '2026-10-03', '2026-10-04']) {
			const week = restOfWeek(day);
			expect(week.length).toBeGreaterThanOrEqual(6);
			expect(week).not.toContain(day);
		}
	});
});

describe('summaryLine', () => {
	it('reads exactly as the brief example does', () => {
		expect(summaryLine({ total: 9, done: 4, plannedMinutes: 330, meetings: 2, overdue: 3 })).toBe(
			'4 of 9 done · 5h 30m planned · 2 meetings · 3 overdue'
		);
	});

	it('drops a clause once it is zero, but never the task count', () => {
		expect(summaryLine({ total: 0, done: 0, plannedMinutes: 0, meetings: 0, overdue: 0 })).toBe('0 of 0 done');
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
	stages: ['lead', 'proposal', 'won'],
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

	it('lists the open tasks of a future day, and the board cards due on it', async () => {
		await vault.write('Work/Board.md', BOARD);
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		const group = data.week.find((w) => w.day === FUTURE);
		expect(group).toBeTruthy();
		expect(group!.openTasks.map((t) => t.text)).toEqual(['Prep the slides']);
		expect(group!.dueCards.map((c) => [c.title, c.workspace.slug])).toEqual([['Send the invoice', 'work']]);
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
		expect(data.week.flatMap((w) => w.dueCards)).toEqual([]);
		expect(data.workspaces.find((w) => w.slug === 'work')?.cards ?? []).toEqual([]);
	});

	it('gives each workspace its most urgent open cards and its inbox count', async () => {
		await vault.write('Work/Board.md', BOARD);
		await vault.write('Work/Inbox.md', '- [ ] Triage this\n- [x] Already triaged\n');
		index.put('Work/Inbox.md', '- [ ] Triage this\n- [x] Already triaged\n');
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		const work = data.workspaces.find((w) => w.slug === 'work');
		expect(work?.inboxCount).toBe(1);
		expect(work?.cards.map((c) => c.title)).toEqual(['Renew the lease', 'Due today', 'Send the invoice']);
		expect(work?.more).toBe(1);
	});

	it('reads the calendar as not configured without failing the page', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.events).toEqual([]);
		expect(data.calendarProblem).toBeNull();
	});

	it('is calm about AI being off by default', async () => {
		const data = await loadToday({ vault, index, workspaces: WORKSPACES }, DAY, { now: now() });
		expect(data.aiEnabled).toBe(false);
		expect(data.briefingText).toBeNull();
	});
});

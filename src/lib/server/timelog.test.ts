import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { NoteIndex } from './index/index';
import {
	TIMER_PATH,
	TIME_LOG_HEADING,
	appendEntry,
	currentTimer,
	dayByWorkspace,
	doneSpans,
	formatEntry,
	loadEntries,
	parseEntryLine,
	parseTimeLog,
	plannedVsActual,
	readTimer,
	startTimer,
	stopTimer,
	timedSpans,
	weekOf,
	weekSummary,
	weekly,
	type Attributed,
	type TimeEntry
} from './timelog';
import type { Workspace } from './workspaces';
import type { Task } from '$lib/shared/task';

const NOTE = `# [[Journal 2026]]

# Tasks
- [ ] 10:40 - 18:00 Work on atlas \`Q1\` #ws/atlas
- [ ] 12:05 - 12:20 Answer the morning post \`Q2\`

## Time log
- 10:42 - 12:05 Work on atlas (1h23m) \`Q1\` #ws/atlas
- 12:05 - 12:20 Answer the morning post (15m) \`Q2\` #ws/personal
just a sentence someone typed here
- 13:00 - 13:30 Something with no tags at all

## Notes
- 20:00 - 21:00 Not a time log line, this is under another heading
`;

describe('parseTimeLog', () => {
	it('reads only the lines under the heading', () => {
		const entries = parseTimeLog(NOTE, '2026-09-21');
		expect(entries.map((e) => e.text)).toEqual([
			'Work on atlas',
			'Answer the morning post',
			'Something with no tags at all'
		]);
	});

	it('records times, minutes, tags and quadrant', () => {
		const [first] = parseTimeLog(NOTE, '2026-09-21');
		expect(first).toMatchObject({
			day: '2026-09-21',
			line: 7,
			startMin: 642,
			endMin: 725,
			minutes: 83,
			text: 'Work on atlas',
			tags: ['ws/atlas'],
			workspace: 'ws/atlas',
			quadrant: 1
		});
		expect(first.raw).toBe('- 10:42 - 12:05 Work on atlas (1h23m) `Q1` #ws/atlas');
	});

	it('is empty for a note with no section, and for one with no note', () => {
		expect(parseTimeLog('# Tasks\n- [ ] something\n')).toEqual([]);
		expect(parseTimeLog('')).toEqual([]);
	});

	it('ignores a section inside a code fence', () => {
		const fenced = '## Backlog\n```\n## Time log\n- 09:00 - 10:00 Example (1h)\n```\n';
		expect(parseTimeLog(fenced)).toEqual([]);
	});

	it('accepts the heading whatever case it is written in', () => {
		expect(parseTimeLog('## TIME LOG\n- 09:00 - 09:30 Standup (30m)\n')).toHaveLength(1);
	});
});

describe('parseEntryLine', () => {
	const cases: Array<[string, Partial<TimeEntry> | null]> = [
		['- 10:42 - 12:05 Work (1h23m)', { startMin: 642, endMin: 725, minutes: 83, text: 'Work' }],
		['- 9:05 - 9:30 Single digit hour', { startMin: 545, endMin: 570, minutes: 25 }],
		['* 08:00 - 08:15 Star bullet', { minutes: 15, text: 'Star bullet' }],
		['  - 08:00 - 08:15 Indented', { minutes: 15, text: 'Indented' }],
		['- 23:50 - 00:10 Past midnight (20m)', { minutes: 20, text: 'Past midnight' }],
		['- 10:00 - 11:00 Call with Ada (with her team) (1h)', { minutes: 60, text: 'Call with Ada (with her team)' }],
		['- 10:00 - 11:00 Tagged #ws/work #billable', { tags: ['ws/work', 'billable'], workspace: 'ws/work', text: 'Tagged' }],
		// The times are the record: a stale duration in brackets is ignored.
		['- 10:00 - 10:30 Stale duration (9h)', { minutes: 30 }],
		['- [ ] 10:00 - 11:00 A task, not a log line', null],
		['- 10:00 Just a start', null],
		['- 25:00 - 26:00 Not a time', null],
		['not a bullet at all', null]
	];
	for (const [raw, expected] of cases) {
		it(`reads ${JSON.stringify(raw)}`, () => {
			const entry = parseEntryLine(raw);
			if (expected === null) expect(entry).toBeNull();
			else expect(entry).toMatchObject(expected);
		});
	}
});

describe('formatEntry', () => {
	it('writes the shape the spec fixes', () => {
		expect(formatEntry({ startMin: 642, endMin: 725, text: 'Work on atlas', workspace: 'ws/atlas', quadrant: 1 })).toBe(
			'- 10:42 - 12:05 Work on atlas (1h23m) `Q1` #ws/atlas'
		);
	});

	it('writes no quadrant or tag when the task had none', () => {
		expect(formatEntry({ startMin: 540, endMin: 555, text: 'Tidy up' })).toBe('- 09:00 - 09:15 Tidy up (15m)');
	});

	it('round-trips through the parser', () => {
		const raw = formatEntry({ startMin: 1430, endMin: 10, text: 'Late night', quadrant: 2 });
		expect(parseEntryLine(raw)).toMatchObject({ startMin: 1430, endMin: 10, minutes: 20, text: 'Late night', quadrant: 2 });
	});
});

describe('plannedVsActual', () => {
	const task = (
		text: string,
		startMin: number,
		endMin: number,
		quadrant: number | null = null,
		status: Task['status'] = 'todo'
	): Task => ({
		path: 'Journal/2026/09/21.md',
		line: 0,
		blockEnd: 0,
		status,
		startMin,
		endMin,
		text,
		quadrant,
		fenced: false,
		raw: '',
		tags: [],
		id: null,
		blockedBy: [],
		due: null
	});
	const entry = (text: string, startMin: number, endMin: number): TimeEntry => parseEntryLine(formatEntry({ text, startMin, endMin }), 0, '2026-09-21')!;

	const done = (text: string, startMin: number, endMin: number, quadrant: number | null = null): Task =>
		task(text, startMin, endMin, quadrant, 'done');

	it('matches a log line to the block of the same name', () => {
		const result = plannedVsActual([task('Work on atlas', 640, 1080, 1)], [entry('Work on atlas', 642, 725)]);
		expect(result.rows).toEqual([
			{
				path: 'Journal/2026/09/21.md',
				line: 0,
				text: 'Work on atlas',
				quadrant: 1,
				plannedMinutes: 440,
				doneMinutes: 0,
				loggedMinutes: 83
			}
		]);
		expect(result.unmatched).toEqual([]);
	});

	it('counts a ticked block nobody timed as done for its planned length', () => {
		const result = plannedVsActual([done('Morning stretch', 570, 600)], []);
		expect(result.rows[0]).toMatchObject({ plannedMinutes: 30, doneMinutes: 30, loggedMinutes: 0 });
		expect(result).toMatchObject({ plannedMinutes: 30, doneMinutes: 30, loggedMinutes: 0 });
		expect(result.done.map((t) => t.text)).toEqual(['Morning stretch']);
	});

	it('counts a timer entry over a ticked block once, as timed', () => {
		const result = plannedVsActual([done('Morning stretch', 570, 600)], [entry('Morning stretch', 570, 595)]);
		expect(result.rows[0]).toMatchObject({ plannedMinutes: 30, doneMinutes: 0, loggedMinutes: 25 });
		expect(result).toMatchObject({ doneMinutes: 0, loggedMinutes: 25 });
		expect(result.done).toEqual([]);
	});

	it('counts an open timed block as planned and nothing else', () => {
		const result = plannedVsActual([task('Client project', 640, 1080)], []);
		expect(result.rows[0]).toMatchObject({ plannedMinutes: 440, doneMinutes: 0, loggedMinutes: 0 });
		expect(result).toMatchObject({ plannedMinutes: 440, doneMinutes: 0, loggedMinutes: 0 });
	});

	it('counts a done block inside another done block once in the done total', () => {
		const result = plannedVsActual([done('Work on eye2gene', 640, 1080), done('Read a book', 840, 870)], []);
		expect(result.doneMinutes).toBe(440);
		expect(result.rows.map((r) => r.doneMinutes)).toEqual([440, 30]);
	});

	// Crossed out is not ticked: a `[-]` block says the work did not happen.
	it('gives a cancelled block no done minutes', () => {
		expect(plannedVsActual([task('Dropped it', 600, 630, null, 'cancelled')], []).doneMinutes).toBe(0);
	});

	it('keeps a planned block with nothing logged against it', () => {
		const result = plannedVsActual([task('Meditate', 570, 600)], []);
		expect(result.rows[0]).toMatchObject({ plannedMinutes: 30, loggedMinutes: 0 });
		expect(result.loggedMinutes).toBe(0);
	});

	it('reports work that was never planned', () => {
		const result = plannedVsActual([task('Meditate', 570, 600)], [entry('Unblock the build', 600, 640)]);
		expect(result.unmatched).toEqual([{ text: 'Unblock the build', minutes: 40 }]);
		expect(result.rows[0].loggedMinutes).toBe(0);
	});

	it('gives an entry to the most specific plan it could belong to', () => {
		const result = plannedVsActual(
			[task('Work', 540, 600), task('Work on atlas', 640, 1080)],
			[entry('Work on atlas', 642, 725)]
		);
		expect(result.rows.find((r) => r.text === 'Work on atlas')!.loggedMinutes).toBe(83);
		expect(result.rows.find((r) => r.text === 'Work')!.loggedMinutes).toBe(0);
	});

	it('matches through markdown and punctuation in the task text', () => {
		const result = plannedVsActual([task('**Work** on [[atlas]]', 640, 1080)], [entry('Work on atlas', 642, 725)]);
		expect(result.rows[0].loggedMinutes).toBe(83);
	});

	it('counts a block inside another block once in the planned total', () => {
		const result = plannedVsActual([task('Client project', 640, 1080), task('Read a book', 840, 870)], []);
		expect(result.plannedMinutes).toBe(440);
		expect(result.rows.map((r) => r.plannedMinutes)).toEqual([440, 30]);
	});

	it('sums several entries logged against one block', () => {
		const result = plannedVsActual([task('Work', 540, 720)], [entry('Work', 540, 600), entry('Work', 620, 660)]);
		expect(result.rows[0].loggedMinutes).toBe(100);
		expect(result.loggedMinutes).toBe(100);
	});
});

describe('weekly', () => {
	const ws = (slug: string, tag: string, color: string): Workspace => ({
		slug,
		name: slug,
		color,
		tag,
		aliases: [],
		folders: [],
		template: 'project',
		tabs: [],
		deck: '',
		kanbanColumns: [],
		path: `_hub/workspaces/${slug}.md`
	});
	const workspaces = [ws('work', 'ws/work', '#2f6fed'), ws('personal', 'ws/personal', '#16a34a')];
	const entry = (day: string, minutes: number, tag: string | null, quadrant: number | null): TimeEntry =>
		parseEntryLine(formatEntry({ startMin: 540, endMin: 540 + minutes, text: 'x', workspace: tag, quadrant }), 0, day)!;

	const spans = timedSpans([
		entry('2026-09-21', 60, 'ws/work', 1),
		entry('2026-09-21', 30, 'ws/personal', 2),
		entry('2026-09-22', 90, 'ws/work', 1),
		entry('2026-09-22', 15, null, null)
	]);

	/** A ticked block, already attributed, which is what `doneSpans` produces. */
	const block = (
		day: string,
		startMin: number,
		endMin: number,
		tag: string | null,
		quadrant: number | null = null
	): Attributed => ({
		day,
		minutes: endMin - startMin,
		workspaceTag: tag,
		quadrant,
		source: 'block',
		startMin,
		endMin
	});

	it('totals by workspace, biggest first', () => {
		const result = weekly(spans, workspaces);
		expect(result.byWorkspace).toEqual([
			{ slug: 'work', name: 'work', color: '#2f6fed', minutes: 150, timedMinutes: 150 },
			{ slug: 'personal', name: 'personal', color: '#16a34a', minutes: 30, timedMinutes: 30 },
			{ slug: '', name: 'Unassigned', color: '#9aa0a6', minutes: 15, timedMinutes: 15 }
		]);
	});

	it('totals by quadrant, with unclassified time last', () => {
		expect(weekly(spans, workspaces).byQuadrant).toEqual([
			{ quadrant: 1, minutes: 150 },
			{ quadrant: 2, minutes: 30 },
			{ quadrant: null, minutes: 15 }
		]);
	});

	it('gives a row for every day asked for, including the empty ones', () => {
		const result = weekly(spans, workspaces, weekOf('2026-09-21'));
		expect(result.byDay).toHaveLength(7);
		expect(result.byDay[0]).toEqual({ day: '2026-09-21', minutes: 90, doneMinutes: 0, loggedMinutes: 90 });
		expect(result.byDay[1]).toEqual({ day: '2026-09-22', minutes: 105, doneMinutes: 0, loggedMinutes: 105 });
		expect(result.byDay[6]).toEqual({ day: '2026-09-27', minutes: 0, doneMinutes: 0, loggedMinutes: 0 });
		expect(result).toMatchObject({ minutes: 195, doneMinutes: 0, loggedMinutes: 195 });
	});

	it('leaves out days outside the range it was given', () => {
		const result = weekly(spans, workspaces, ['2026-09-22']);
		expect(result.minutes).toBe(105);
		// The by-workspace totals still cover everything passed in, so the
		// caller filters spans, not the range.
		expect(result.byWorkspace.reduce((sum, w) => sum + w.minutes, 0)).toBe(195);
	});

	it('counts a tag naming no known workspace as unassigned', () => {
		expect(weekly(timedSpans([entry('2026-09-21', 10, 'ws/deleted', null)]), workspaces).byWorkspace).toEqual([
			{ slug: '', name: 'Unassigned', color: '#9aa0a6', minutes: 10, timedMinutes: 10 }
		]);
	});

	it('counts a week of ticked blocks and never a timer that was not run', () => {
		const result = weekly(
			[block('2026-09-21', 600, 660, 'ws/work', 1), block('2026-09-22', 600, 690, 'ws/work', 1)],
			workspaces,
			weekOf('2026-09-21')
		);
		expect(result).toMatchObject({ minutes: 150, doneMinutes: 150, loggedMinutes: 0 });
		expect(result.byDay[0]).toEqual({ day: '2026-09-21', minutes: 60, doneMinutes: 60, loggedMinutes: 0 });
		expect(result.byWorkspace).toEqual([
			{ slug: 'work', name: 'work', color: '#2f6fed', minutes: 150, timedMinutes: 0 }
		]);
	});

	it('merges blocks inside blocks but adds timer minutes up', () => {
		const result = weekly(
			[
				block('2026-09-21', 600, 1080, 'ws/work', 1),
				block('2026-09-21', 840, 870, 'ws/work', 1),
				...timedSpans([entry('2026-09-21', 20, 'ws/work', 1)])
			],
			workspaces,
			['2026-09-21']
		);
		expect(result).toMatchObject({ doneMinutes: 480, loggedMinutes: 20, minutes: 500 });
	});

	it('gives the same block to two days rather than merging across them', () => {
		const result = weekly(
			[block('2026-09-21', 600, 660, 'ws/work', 1), block('2026-09-22', 600, 660, 'ws/work', 1)],
			workspaces,
			weekOf('2026-09-21')
		);
		expect(result.doneMinutes).toBe(120);
	});

	// A long block of one workspace containing a short one of another: each
	// workspace is asked its own question, so the answers can add up to more
	// than the day. The widget says so in a line.
	it('lets per-workspace totals exceed the day they happened in', () => {
		const result = weekly(
			[block('2026-09-21', 600, 1080, 'ws/work', 1), block('2026-09-21', 840, 870, 'ws/personal', 3)],
			workspaces,
			['2026-09-21']
		);
		expect(result.byDay[0].doneMinutes).toBe(480);
		expect(result.byWorkspace).toEqual([
			{ slug: 'work', name: 'work', color: '#2f6fed', minutes: 480, timedMinutes: 0 },
			{ slug: 'personal', name: 'personal', color: '#16a34a', minutes: 30, timedMinutes: 0 }
		]);
		expect(result.byWorkspace.reduce((sum, w) => sum + w.minutes, 0)).toBeGreaterThan(result.byDay[0].minutes);
	});
});

describe('doneSpans', () => {
	const ws = (slug: string, tag: string, aliases: string[], folders: string[]): Workspace => ({
		slug,
		name: slug,
		color: '#000',
		tag,
		aliases,
		folders,
		template: 'project',
		tabs: [],
		deck: '',
		kanbanColumns: [],
		path: `_hub/workspaces/${slug}.md`
	});
	const workspaces = [ws('work', 'ws/work', [], ['Work']), ws('kaya', 'ws/kaya', ['Kaya'], ['Kaya Thai'])];
	const block = (text: string, tags: string[] = []): Task => ({
		path: 'Journal/2026/09/21.md',
		line: 1,
		blockEnd: 1,
		status: 'done',
		startMin: 630,
		endMin: 720,
		text,
		quadrant: 1,
		fenced: false,
		raw: '',
		tags,
		id: null,
		blockedBy: [],
		due: null
	});

	it('attributes a block by the tag it carries', () => {
		expect(doneSpans('2026-09-21', [block('Write the brief', ['ws/work'])], workspaces)[0]).toEqual({
			day: '2026-09-21',
			minutes: 90,
			workspaceTag: 'ws/work',
			quadrant: 1,
			source: 'block',
			startMin: 630,
			endMin: 720
		});
	});

	it('attributes a block by an alias in its words, with nothing on the line', () => {
		expect(doneSpans('2026-09-21', [block('Work on Kaya')], workspaces)[0].workspaceTag).toBe('ws/kaya');
	});

	it('attributes a block nobody claims to nobody', () => {
		expect(doneSpans('2026-09-21', [block('Morning stretch')], workspaces)[0].workspaceTag).toBeNull();
	});

	it('skips a block with no clock, which is not a span at all', () => {
		expect(doneSpans('2026-09-21', [{ ...block('Someday'), startMin: null, endMin: null }], workspaces)).toEqual([]);
	});
});

describe('dayByWorkspace', () => {
	const ws = (slug: string, aliases: string[]): Workspace => ({
		slug,
		name: slug,
		color: '#000',
		tag: `ws/${slug}`,
		aliases,
		folders: [],
		template: 'project',
		tabs: [],
		deck: '',
		kanbanColumns: [],
		path: `_hub/workspaces/${slug}.md`
	});
	const workspaces = [ws('client', ['Client project']), ws('wellbeing', ['Morning stretch'])];

	let nextLine = 0;
	const block = (text: string, startMin: number, endMin: number, status: Task['status'] = 'todo'): Task => ({
		path: 'Journal/2026/09/21.md',
		line: nextLine++,
		blockEnd: nextLine,
		status,
		startMin,
		endMin,
		text,
		quadrant: null,
		fenced: false,
		raw: '',
		tags: [],
		id: null,
		blockedBy: [],
		due: null
	});
	const entry = (text: string, startMin: number, endMin: number): TimeEntry =>
		parseEntryLine(formatEntry({ text, startMin, endMin }), 99, '2026-09-21')!;

	beforeEach(() => {
		nextLine = 0;
	});

	it('splits the day between the workspaces its blocks name', () => {
		const split = dayByWorkspace(
			[block('Client project', 640, 1080), block('Morning stretch', 570, 600, 'done')],
			[],
			workspaces
		);
		expect(split).toEqual([
			{ slug: 'client', name: 'client', color: '#000', plannedMinutes: 440, doneMinutes: 0 },
			{ slug: 'wellbeing', name: 'wellbeing', color: '#000', plannedMinutes: 30, doneMinutes: 30 }
		]);
	});

	it('counts a block inside another block of the same workspace once', () => {
		const split = dayByWorkspace(
			[block('Client project', 640, 1080), block('Client project call', 700, 760, 'done'), block('Client project review', 720, 780, 'done')],
			[],
			workspaces
		);
		// 10:40-18:00 planned, and 11:40-13:00 of it ticked as two overlapping
		// blocks, which is 80 minutes of the day rather than 120.
		expect(split).toEqual([{ slug: 'client', name: 'client', color: '#000', plannedMinutes: 440, doneMinutes: 80 }]);
	});

	it('counts a tick the timer never measured', () => {
		const split = dayByWorkspace([block('Morning stretch', 570, 600, 'done')], [], workspaces);
		expect(split[0].doneMinutes).toBe(30);
	});

	it('does not count a tick twice when a timer measured the same work', () => {
		const split = dayByWorkspace(
			[block('Morning stretch', 570, 600, 'done')],
			[entry('Morning stretch', 572, 595)],
			workspaces
		);
		expect(split[0]).toMatchObject({ plannedMinutes: 30, doneMinutes: 0 });
	});

	it('gives a cancelled block its planned time and no done time', () => {
		const split = dayByWorkspace([block('Morning stretch', 570, 600, 'cancelled')], [], workspaces);
		expect(split[0]).toMatchObject({ plannedMinutes: 30, doneMinutes: 0 });
	});

	it('leaves out a block no workspace claims', () => {
		expect(dayByWorkspace([block('Read a book', 840, 870)], [], workspaces)).toEqual([]);
	});

	it('leaves out a block with no clock, which is not time at all', () => {
		const loose = { ...block('Client project', 0, 0), startMin: 600, endMin: null };
		expect(dayByWorkspace([loose], [], workspaces)).toEqual([]);
	});

	it('is empty for a day with no blocks', () => {
		expect(dayByWorkspace([], [], workspaces)).toEqual([]);
	});
});

describe('weekOf', () => {
	it('starts on the Monday', () => {
		// 2026-09-21 is a Monday, 2026-09-27 the Sunday after.
		expect(weekOf('2026-09-21')[0]).toBe('2026-09-21');
		expect(weekOf('2026-09-27')).toEqual(weekOf('2026-09-21'));
		expect(weekOf('2026-09-23')[0]).toBe('2026-09-21');
		expect(weekOf('2026-09-21')).toHaveLength(7);
	});

	it('crosses a month boundary', () => {
		expect(weekOf('2026-10-01')[0]).toBe('2026-09-28');
	});
});

describe('readTimer', () => {
	it('reads a written timer back', () => {
		const timer = {
			path: 'Journal/2026/09/21.md',
			line: 4,
			text: 'Work on atlas',
			workspace: 'ws/work',
			quadrant: 1,
			startedAt: '2026-09-21T10:42:00.000Z',
			day: '2026-09-21'
		};
		expect(readTimer(JSON.stringify(timer))).toEqual(timer);
	});

	const junk = ['', '   ', '{}', 'not json at all', '{"path":"a.md"}', '{"path":"a.md","line":1,"startedAt":"soon"}'];
	for (const content of junk) {
		it(`reads ${JSON.stringify(content)} as no timer`, () => {
			expect(readTimer(content)).toBeNull();
		});
	}
});

describe('against a vault', () => {
	let root: string;
	let vault: Vault;
	const DAY = '2026-09-21';
	const PATH = 'Journal/2026/09/21.md';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-timelog-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('appends one line and leaves every other byte alone', async () => {
		await vault.write(PATH, NOTE);
		const appended = await appendEntry(vault, DAY, { startMin: 840, endMin: 870, text: 'Read a book', quadrant: 2 });

		expect(appended.raw).toBe('- 14:00 - 14:30 Read a book (30m) `Q2`');
		const after = (await vault.read(PATH)).content.split('\n');
		const before = NOTE.split('\n');
		expect(after).toHaveLength(before.length + 1);
		expect(after.filter((l) => !before.includes(l) || l === appended.raw)).toContain(appended.raw);
		expect(after.toSpliced(appended.line, 1)).toEqual(before);
	});

	it('creates the note from the template when the day has none', async () => {
		await vault.write('Journal/Journal Template.md', '# Tasks\n- [ ] Morning stretch `Q1`\n');
		await appendEntry(vault, DAY, { startMin: 540, endMin: 570, text: 'Morning stretch' });

		const content = (await vault.read(PATH)).content;
		expect(content).toContain('- [ ] Morning stretch `Q1`');
		expect(content).toContain('## Time log\n- 09:00 - 09:30 Morning stretch (30m)');
	});

	it('reads several days back as one list', async () => {
		await vault.write(PATH, NOTE);
		await vault.write('Journal/2026/09/22.md', '## Time log\n- 09:00 - 10:00 Next day (1h)\n');
		const entries = await loadEntries(vault, ['2026-09-21', '2026-09-22', '2026-09-23']);
		expect(entries.map((e) => `${e.day} ${e.minutes}`)).toEqual([
			'2026-09-21 83',
			'2026-09-21 15',
			'2026-09-21 30',
			'2026-09-22 60'
		]);
	});

	describe('weekSummary', () => {
		// What the Time widget renders, end to end: notes on disk in, one object
		// out. Everything below it is pure and tested above.
		let index: NoteIndex;
		const WORK: Workspace = {
			slug: 'work',
			name: 'Work',
			color: '#2f6fed',
			tag: 'ws/work',
			aliases: [],
			folders: ['Work'],
			template: 'project',
			tabs: [],
			deck: '',
			kanbanColumns: [],
			path: '_hub/workspaces/work.md'
		};

		beforeEach(async () => {
			index = new NoteIndex(':memory:');
			const monday = [
				'# Tasks',
				'- [ ] 09:00 - 10:00 Write the brief `Q1` #ws/work',
				'- [ ] 10:00 - 10:30 Walk the dog `Q2`',
				'',
				'## Time log',
				'- 09:05 - 10:10 Write the brief (1h5m) `Q1` #ws/work',
				'- 11:00 - 11:20 Unblock the build (20m) `Q1` #ws/work',
				'- 12:00 - 12:30 Walk the dog (30m) `Q2`'
			].join('\n');
			await vault.write('Journal/2026/09/21.md', monday);
			index.put('Journal/2026/09/21.md', monday);
		});
		afterEach(() => index.close());

		it('gives a row for every day of the week, with planned and logged', async () => {
			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-09-21'),
				workspaces: [WORK],
				workspace: null
			});
			expect(summary.days).toHaveLength(7);
			expect(summary.days[0]).toEqual({ day: '2026-09-21', plannedMinutes: 90, doneMinutes: 0, loggedMinutes: 115 });
			expect(summary.days[1]).toEqual({ day: '2026-09-22', plannedMinutes: 0, doneMinutes: 0, loggedMinutes: 0 });
			expect(summary).toMatchObject({ plannedMinutes: 90, doneMinutes: 0, loggedMinutes: 115, scoped: false });
			expect(summary.unmatched).toEqual([{ text: 'Unblock the build', minutes: 20 }]);
		});

		it('narrows to one workspace by the tag on the log line', async () => {
			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-09-21'),
				workspaces: [WORK],
				workspace: WORK
			});
			expect(summary.loggedMinutes).toBe(85);
			expect(summary.byWorkspace).toEqual([
				{ slug: 'work', name: 'Work', color: '#2f6fed', minutes: 85, timedMinutes: 85 }
			]);
			expect(summary.byQuadrant).toEqual([{ quadrant: 1, minutes: 85 }]);
			expect(summary.scoped).toBe(true);
		});

		// The shape of the author's own notes: a project named in the words of a
		// daily block, with no tag anywhere on the line.
		const KAYA: Workspace = {
			...WORK,
			slug: 'kaya',
			name: 'Kaya',
			tag: 'ws/kaya',
			aliases: ['Kaya'],
			folders: ['Kaya Thai'],
			path: '_hub/workspaces/kaya.md'
		};

		it('counts a planned block that only names the workspace in its words', async () => {
			const tuesday = [
				'# Tasks',
				'- [ ] 10:30 - 12:00 Work on Kaya `Q1`',
				'- [ ] 13:00 - 13:30 Walk the dog `Q2`'
			].join('\n');
			await vault.write('Journal/2026/09/22.md', tuesday);
			index.put('Journal/2026/09/22.md', tuesday);

			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-09-21'),
				workspaces: [WORK, KAYA],
				workspace: KAYA
			});
			expect(summary.days[1]).toEqual({ day: '2026-09-22', plannedMinutes: 90, doneMinutes: 0, loggedMinutes: 0 });
			// Monday's blocks belong to Work or to nobody, so they are not Kaya's.
			expect(summary.days[0]).toEqual({ day: '2026-09-21', plannedMinutes: 0, doneMinutes: 0, loggedMinutes: 0 });
			expect(summary).toMatchObject({ plannedMinutes: 90, doneMinutes: 0, loggedMinutes: 0, scoped: true });
		});

		// The author's own week: every block ticked, the timer never touched.
		it('counts a week that was ticked rather than timed', async () => {
			const wednesday = [
				'# Tasks',
				'- [x] 10:30 - 18:00 Work on Kaya `Q1`',
				'- [x] 14:00 - 14:30 Read a book `Q3`',
				'- [ ] 19:00 - 20:00 Never got to this `Q2`'
			].join('\n');
			await vault.write('Journal/2026/09/23.md', wednesday);
			index.put('Journal/2026/09/23.md', wednesday);

			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-09-21'),
				workspaces: [WORK, KAYA],
				workspace: null
			});
			// The book sits inside the Kaya block, so the day counts it once.
			expect(summary.days[2]).toEqual({
				day: '2026-09-23',
				plannedMinutes: 510,
				doneMinutes: 450,
				loggedMinutes: 0
			});
			expect(summary.doneMinutes).toBe(450);
			// Monday's timer lines are still the timer's, and nothing else moved.
			expect(summary.loggedMinutes).toBe(115);
			expect(summary.byWorkspace).toEqual([
				{ slug: 'kaya', name: 'Kaya', color: '#2f6fed', minutes: 450, timedMinutes: 0 },
				{ slug: 'work', name: 'Work', color: '#2f6fed', minutes: 85, timedMinutes: 85 },
				{ slug: '', name: 'Unassigned', color: '#9aa0a6', minutes: 60, timedMinutes: 30 }
			]);
		});

		it('never counts a ticked block a timer already recorded', async () => {
			const thursday = ['# Tasks', '- [x] 09:00 - 10:00 Write the brief `Q1` #ws/work', '', '## Time log', '- 09:05 - 09:35 Write the brief (30m) `Q1` #ws/work'].join('\n');
			await vault.write('Journal/2026/09/24.md', thursday);
			index.put('Journal/2026/09/24.md', thursday);

			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-09-21'),
				workspaces: [WORK],
				workspace: WORK
			});
			expect(summary.days[3]).toEqual({
				day: '2026-09-24',
				plannedMinutes: 60,
				doneMinutes: 0,
				loggedMinutes: 30
			});
		});

		it('is all zeroes for a week nobody logged anything in', async () => {
			const summary = await weekSummary(vault, index, {
				days: weekOf('2026-10-05'),
				workspaces: [WORK],
				workspace: null
			});
			expect(summary.loggedMinutes).toBe(0);
			expect(summary.doneMinutes).toBe(0);
			expect(summary.days.every((d) => d.loggedMinutes === 0 && d.plannedMinutes === 0)).toBe(true);
		});
	});

	describe('the timer', () => {
		const start = new Date('2026-09-21T10:42:30');

		beforeEach(async () => {
			await vault.write(PATH, NOTE);
		});

		it('is nothing until something starts it', async () => {
			expect(await currentTimer(vault)).toBeNull();
			expect(await stopTimer(vault)).toBeNull();
		});

		it('takes its name, quadrant and workspace from the task line', async () => {
			const { timer } = await startTimer(vault, [], { path: PATH, line: 3 }, start);
			expect(timer).toMatchObject({
				path: PATH,
				line: 3,
				text: 'Work on atlas',
				quadrant: 1,
				day: '2026-09-21'
			});
			expect(await currentTimer(vault)).toEqual(timer);
		});

		it('survives being read back from the file, which is where it lives', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, start);
			const fresh = new Vault(root);
			try {
				expect(await currentTimer(fresh)).toMatchObject({ text: 'Work on atlas' });
			} finally {
				await fresh.close();
			}
			expect((await vault.read(TIMER_PATH)).exists).toBe(true);
		});

		it('logs the stretch it measured and clears itself', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, start);
			const stopped = await stopTimer(vault, new Date('2026-09-21T12:05:10'));

			expect(stopped!.raw).toBe('- 10:42 - 12:05 Work on atlas (1h23m) `Q1`');
			expect((await vault.read(PATH)).content).toContain(stopped!.raw);
			expect(await currentTimer(vault)).toBeNull();
			expect(await stopTimer(vault)).toBeNull();
		});

		it('records a minute for a timer stopped inside one', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, start);
			const stopped = await stopTimer(vault, new Date('2026-09-21T10:42:40'));
			expect(stopped!.entry.minutes).toBe(1);
		});

		it('records just under a day for a timer left running', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, start);
			const stopped = await stopTimer(vault, new Date('2026-09-23T10:42:40'));
			expect(stopped!.entry.minutes).toBe(1439);
			// The clock range on the line still adds up to what it says.
			expect(parseEntryLine(stopped!.raw)!.minutes).toBe(1439);
		});

		it('logs the first timer when a second one starts', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, start);
			const { timer, stopped } = await startTimer(vault, [], { path: PATH, line: 4 }, new Date('2026-09-21T11:00:00'));

			expect(stopped!.raw).toBe('- 10:42 - 11:00 Work on atlas (18m) `Q1`');
			expect(timer.text).toBe('Answer the morning post');
			expect(await currentTimer(vault)).toMatchObject({ line: 4 });
		});

		it('times a line that is not a task rather than refusing', async () => {
			const { timer } = await startTimer(vault, [], { path: PATH, line: 0 }, start);
			expect(timer.text).toBe('Journal 2026');
			expect(timer.quadrant).toBeNull();
		});

		it('falls back to the note name for a line that is not there', async () => {
			const { timer } = await startTimer(vault, [], { path: 'Work/Nothing Here.md', line: 99 }, start);
			expect(timer.text).toBe('Nothing Here');
		});

		it('writes the workspace of the timed note onto the log line', async () => {
			const workspaces: Workspace[] = [
				{
					slug: 'work',
					name: 'Work',
					color: '#2f6fed',
					tag: 'ws/work',
					aliases: [],
					folders: ['Work'],
					template: 'project',
					tabs: [],
					deck: '',
					kanbanColumns: [],
					path: '_hub/workspaces/work.md'
				}
			];
			await vault.write('Work/Tasks.md', '- [ ] Fix the build `Q1`\n');
			await startTimer(vault, workspaces, { path: 'Work/Tasks.md', line: 0 }, start);
			const stopped = await stopTimer(vault, new Date('2026-09-21T11:12:00'));
			expect(stopped!.raw).toBe('- 10:42 - 11:12 Fix the build (30m) `Q1` #ws/work');
			expect(stopped!.entry.workspace).toBe('ws/work');
		});

		it('takes the workspace from the words when the line carries no tag', async () => {
			const kaya: Workspace = {
				slug: 'kaya',
				name: 'Kaya',
				color: '#000',
				tag: 'ws/kaya',
				aliases: ['Kaya'],
				folders: ['Kaya Thai'],
				template: 'project',
				tabs: [],
				deck: '',
				kanbanColumns: [],
				path: '_hub/workspaces/kaya.md'
			};
			await vault.write(PATH, '# Tasks\n- [ ] 10:30 - 18:00 Work on Kaya `Q1`\n');
			await startTimer(vault, [kaya], { path: PATH, line: 1 }, start);
			const stopped = await stopTimer(vault, new Date('2026-09-21T11:12:00'));
			expect(stopped!.raw).toBe('- 10:42 - 11:12 Work on Kaya (30m) `Q1` #ws/kaya');
			expect(stopped!.entry.workspace).toBe('ws/kaya');
		});

		it('logs against the day it started on, not the day it stopped', async () => {
			await startTimer(vault, [], { path: PATH, line: 3 }, new Date('2026-09-21T23:50:00'));
			const stopped = await stopTimer(vault, new Date('2026-09-22T00:10:00'));
			expect(stopped!.path).toBe(PATH);
			expect(stopped!.raw).toBe('- 23:50 - 00:10 Work on atlas (20m) `Q1`');
		});
	});
});

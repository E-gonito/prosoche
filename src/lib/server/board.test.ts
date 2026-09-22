import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NoteIndex } from './index/index';
import { buildBoard, columnsFor } from './board';
import type { Workspace } from './workspaces';

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

const STUDY = workspace({ slug: 'study', name: 'Study', tag: 'ws/study', folders: ['Study'], deck: 'Study/Tasks.md' });

const NOTES: Record<string, string> = {
	'Work/Tasks.md': [
		'# Work',
		'- [ ] Draft the plan `Q2` 📅 2026-09-23 🆔 plan1',
		'- [/] Own the pipeline `Q1`',
		'- [ ] Ship the release `Q3` ⛔ plan1',
		'- [x] Renew the certificate `Q4`',
		'- [ ] Waiting on someone else `Q2` ⛔ gone-away',
		'- [ ] a bare line about the office',
		'## Backlog',
		'```',
		'- [ ] Fenced, and left alone `Q2`',
		'```',
		''
	].join('\n'),
	// Checklist notation, which is what most `- [ ]` lines in this vault are.
	'Work/Syllabus.md': ['# Syllabus', '- [ ] **Indexing:** sharding', '- [ ] `btree` versus `hash`', ''].join('\n'),
	// Claimed by tag from outside the folders.
	'Study/Shared.md': ['# Shared', '- [ ] Read the handbook #ws/work `Q2`', ''].join('\n'),
	// Inside the folders, but another workspace's tag owns it.
	'Work/Course.md': ['# Course', '- [ ] Finish chapter 3 #ws/study `Q2`', ''].join('\n'),
	// A daily note: a template copy, and its blocks belong on Today.
	'Journal/2026/09/21.md': ['# Day', '- [ ] 09:00 - 10:00 Work block #ws/work `Q1`', ''].join('\n'),
	// The workspace definition itself.
	'_hub/workspaces/work.md': ['---', 'name: Work', '---', '- [ ] not work `Q1`', ''].join('\n'),
	'Work/Parked.md': ['# Parked', '- [/] Sitting in review `Q1` #col/review', ''].join('\n')
};

let index: NoteIndex;
beforeEach(() => {
	index = new NoteIndex(':memory:');
	for (const [path, content] of Object.entries(NOTES)) index.put(path, content);
});
afterEach(() => index.close());

describe('columnsFor', () => {
	it('gives the five statuses when the workspace names none', () => {
		expect(columnsFor(workspace()).map((c) => c.title)).toEqual([
			'To do',
			'In progress',
			'Blocked',
			'Done',
			'Cancelled'
		]);
		expect(columnsFor(workspace()).every((c) => c.tag === null)).toBe(true);
	});

	it('maps a title that names a status to that status, and anything else to a tag', () => {
		const columns = columnsFor(workspace({ kanbanColumns: ['To do', 'Doing', 'Review', 'Done'] }));
		expect(columns).toEqual([
			{ key: 'to-do', title: 'To do', status: 'todo', tag: null },
			{ key: 'doing', title: 'Doing', status: null, tag: 'col/doing' },
			{ key: 'review', title: 'Review', status: null, tag: 'col/review' },
			{ key: 'done', title: 'Done', status: 'done', tag: null }
		]);
	});

	it('never leaves a workspace with nowhere to put a card', () => {
		expect(columnsFor(workspace({ kanbanColumns: ['', '  ', '!!!'] })).map((c) => c.key)).toEqual([
			'todo',
			'in-progress',
			'blocked',
			'done',
			'cancelled'
		]);
	});

	it('collapses a repeated title rather than making two columns with one key', () => {
		expect(columnsFor(workspace({ kanbanColumns: ['Review', 'review', 'Done'] })).map((c) => c.key)).toEqual([
			'review',
			'done'
		]);
	});
});

describe('buildBoard', () => {
	const board = () => buildBoard(index, workspace(), [workspace(), STUDY]);
	const cardsIn = (key: string) => board().columns.find((c) => c.key === key)!.cards.map((c) => c.task.text);

	it('puts each card in the column its status names', () => {
		expect(cardsIn('todo')).toEqual([
			'Draft the plan',
			'Read the handbook',
			'Waiting on someone else',
			'Ship the release'
		]);
		expect(cardsIn('in-progress')).toEqual(['Sitting in review', 'Own the pipeline']);
		expect(cardsIn('done')).toEqual(['Renew the certificate']);
		expect(cardsIn('blocked')).toEqual([]);
	});

	it('sorts each column by quadrant, then due date', () => {
		// The Q2 card with a due date first, then the Q2 cards in vault order,
		// then Q3. Q1 is in another column here.
		expect(cardsIn('todo').slice(0, 2)).toEqual(['Draft the plan', 'Read the handbook']);
		expect(cardsIn('todo').at(-1)).toBe('Ship the release');
	});

	it('takes the workspace tag as intent wherever the note lives', () => {
		expect(cardsIn('todo')).toContain('Read the handbook');
	});

	it('leaves checklist notation out, and says how much of it there was', () => {
		const built = board();
		const shown = built.columns.flatMap((c) => c.cards).map((c) => c.task.text);
		expect(shown).not.toContain('**Indexing:** sharding');
		expect(shown).not.toContain('a bare line about the office');
		// Two syllabus lines and the bare line in Tasks.md.
		expect(built.excluded).toBe(3);
	});

	it('offers the left-out lines for review, grouped by the note they live in', () => {
		const candidates = board().candidates;
		expect(candidates.map((c) => c.path)).toEqual(['Work/Syllabus.md', 'Work/Tasks.md']);
		expect(candidates[0].title).toBe('Syllabus');
		expect(candidates[0].tasks.map((t) => t.line)).toEqual([1, 2]);
		expect(candidates[1].tasks).toHaveLength(1);
	});

	it('leaves the fenced backlog, the daily notes and _hub out entirely', () => {
		const built = board();
		const paths = [
			...built.columns.flatMap((c) => c.cards.map((card) => card.task.path)),
			...built.candidates.map((c) => c.path)
		];
		expect(paths).not.toContain('Journal/2026/09/21.md');
		expect(paths).not.toContain('_hub/workspaces/work.md');
		expect(built.columns.flatMap((c) => c.cards).map((c) => c.task.text)).not.toContain('Fenced, and left alone');
	});

	it('gives a card claimed by another workspace tag to that workspace only', () => {
		const shown = board().columns.flatMap((c) => c.cards).map((c) => c.task.text);
		expect(shown).not.toContain('Finish chapter 3');
		// And it is not counted as something this board left out, either.
		expect(board().excluded).toBe(3);

		const study = buildBoard(index, STUDY, [workspace(), STUDY]);
		expect(study.columns.flatMap((c) => c.cards).map((c) => c.task.text)).toEqual(['Finish chapter 3']);
	});

	it('resolves what each card is waiting on, across notes', () => {
		const ship = board()
			.columns.flatMap((c) => c.cards)
			.find((c) => c.task.text === 'Ship the release')!;
		expect(ship.blockers).toHaveLength(1);
		expect(ship.blockers[0].id).toBe('plan1');
		expect(ship.blockers[0].task?.text).toBe('Draft the plan');
	});

	it('reports a blocker that no longer exists rather than dropping the card', () => {
		const waiting = board()
			.columns.flatMap((c) => c.cards)
			.find((c) => c.task.text === 'Waiting on someone else')!;
		expect(waiting.blockers).toEqual([{ id: 'gone-away', task: null }]);
	});

	it('honours a col/ tag over the status when the workspace names its columns', () => {
		const named = workspace({ kanbanColumns: ['To do', 'Review', 'Done'] });
		const built = buildBoard(index, named, [named, STUDY]);
		expect(built.columns.find((c) => c.key === 'review')!.cards.map((c) => c.task.text)).toEqual([
			'Sitting in review'
		]);
		// With no In progress column, the rest fall to the first column.
		expect(built.columns.find((c) => c.key === 'to-do')!.cards.map((c) => c.task.text)).toContain(
			'Own the pipeline'
		);
	});

	it('says where a new card would go', () => {
		expect(board().deck).toBe('Work/Tasks.md');
	});

	it('returns an empty board rather than failing when the index is empty', () => {
		const empty = new NoteIndex(':memory:');
		const built = buildBoard(empty, workspace(), [workspace()]);
		expect(built.columns).toHaveLength(5);
		expect(built.columns.every((c) => c.cards.length === 0)).toBe(true);
		expect(built).toMatchObject({ excluded: 0, candidates: [] });
		empty.close();
	});
});

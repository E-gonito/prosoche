import { describe, it, expect } from 'vitest';
import {
	columnFor,
	compareCards,
	compareTasks,
	isCard,
	moveEdit,
	showsIntent,
	type Card,
	type CardRule,
	type Column
} from './board';
import type { Task } from './task';

function task(fields: Partial<Task> = {}): Task {
	return {
		path: 'Work/Tasks.md',
		line: 1,
		blockEnd: 1,
		status: 'todo',
		startMin: null,
		endMin: null,
		text: 'Do the thing',
		quadrant: null,
		fenced: false,
		raw: '- [ ] Do the thing',
		tags: [],
		id: null,
		blockedBy: [],
		due: null,
		...fields
	};
}

const card = (fields: Partial<Task> = {}): Card => ({ task: task(fields), blockers: [] });

const STATUSES: Column[] = [
	{ key: 'todo', title: 'To do', status: 'todo', tag: null },
	{ key: 'in-progress', title: 'In progress', status: 'in-progress', tag: null },
	{ key: 'done', title: 'Done', status: 'done', tag: null }
];

const MIXED: Column[] = [
	{ key: 'todo', title: 'To do', status: 'todo', tag: null },
	{ key: 'review', title: 'Review', status: null, tag: 'col/review' },
	{ key: 'done', title: 'Done', status: 'done', tag: null }
];

describe('isCard', () => {
	const WORK: CardRule = { tag: 'ws/work', deck: 'Work/Deck.md' };
	const STUDY: CardRule = { tag: 'ws/study', deck: 'Study/Deck.md' };

	it('counts a tagged task even when it carries nothing else', () => {
		expect(isCard(task({ tags: ['ws/work'] }), WORK)).toBe(true);
	});

	it('counts a task tagged under the workspace tag', () => {
		expect(isCard(task({ tags: ['ws/work/api'] }), WORK)).toBe(true);
	});

	it('counts a line in the deck note, with no metadata at all', () => {
		// The deck is the board written down: putting a line there is intent.
		expect(isCard(task({ path: 'Work/Deck.md', text: 'weekly sync agenda' }), WORK)).toBe(true);
	});

	it('still asks a line outside the deck to show intent', () => {
		expect(isCard(task({ path: 'Work/Test plan.md', text: 'weekly sync agenda' }), WORK)).toBe(false);
	});

	it('reads the deck as a whole path, not a folder', () => {
		// `Work/Deck.md.bak` and `Work/Deck.md/notes.md` are other notes.
		expect(isCard(task({ path: 'Work/Deck.md.bak' }), WORK)).toBe(false);
	});

	it('leaves a bare checklist line out', () => {
		// The shape of this vault's syllabus and test-plan notes.
		expect(isCard(task({ text: '**Indexing:** sharding' }), STUDY)).toBe(false);
	});

	it.each([
		['a quadrant', { quadrant: 2 }],
		['a due date', { due: '2026-09-23' }],
		['an id', { id: 'a1b2c3' }],
		['a dependency', { blockedBy: ['a1b2c3'] }]
	])('counts a folder-claimed line that shows intent through %s', (_label, fields) => {
		expect(isCard(task(fields), STUDY)).toBe(true);
		expect(showsIntent(task(fields))).toBe(true);
	});

	it('does not treat a time block or a status marker as intent', () => {
		expect(isCard(task({ startMin: 600, endMin: 660, status: 'in-progress' }), WORK)).toBe(false);
	});
});

describe('columnFor', () => {
	it('puts a task in the column matching its status', () => {
		expect(columnFor(task({ status: 'in-progress' }), STATUSES).key).toBe('in-progress');
	});

	it('falls back to the first column when no status matches', () => {
		// 'cancelled' has no column in this workspace's list.
		expect(columnFor(task({ status: 'cancelled' }), STATUSES).key).toBe('todo');
	});

	it('lets a col/ tag beat the status, so a parked card stays parked', () => {
		expect(columnFor(task({ status: 'in-progress', tags: ['col/review'] }), MIXED).key).toBe('review');
	});

	it('ignores a col/ tag no column in this workspace uses', () => {
		expect(columnFor(task({ status: 'done', tags: ['col/shipped'] }), MIXED).key).toBe('done');
	});
});

describe('moveEdit', () => {
	const column = (key: string) => MIXED.find((c) => c.key === key)!;

	it('sets the status and strips every col/ tag when moving to a status column', () => {
		const moved = moveEdit(task({ tags: ['ws/work', 'col/review', 'col/waiting'] }), column('done'));
		expect(moved).toEqual({ status: 'done', removeTags: ['col/review', 'col/waiting'] });
	});

	it('adds the tag and leaves the status alone when moving to a tag column', () => {
		const moved = moveEdit(task({ status: 'in-progress', tags: ['col/waiting'] }), column('review'));
		expect(moved).toEqual({ addTags: ['col/review'], removeTags: ['col/waiting'] });
		expect(moved.status).toBeUndefined();
	});

	it('is a no-op edit for a card already in its tag column', () => {
		expect(moveEdit(task({ tags: ['col/review'] }), column('review'))).toEqual({});
	});

	it('keeps tags that are not column tags', () => {
		const moved = moveEdit(task({ tags: ['ws/work', 'pin', 'col/review'] }), column('todo'));
		expect(moved.removeTags).toEqual(['col/review']);
	});
});

describe('compareCards', () => {
	it('orders by quadrant, then due date, then position in the vault', () => {
		const cards = [
			card({ path: 'b.md', line: 2 }),
			card({ quadrant: 2, due: '2026-10-01' }),
			card({ quadrant: 1 }),
			card({ quadrant: 2, due: '2026-09-01' }),
			card({ path: 'b.md', line: 1 })
		];
		const order = [...cards].sort(compareCards).map((c) => [c.task.quadrant, c.task.due, c.task.line]);
		expect(order).toEqual([
			[1, null, 1],
			[2, '2026-09-01', 1],
			[2, '2026-10-01', 1],
			[null, null, 1],
			[null, null, 2]
		]);
	});

	it('sorts the same way twice, so a board does not shuffle between loads', () => {
		const cards = [card({ line: 3 }), card({ line: 1 }), card({ line: 2 })];
		const once = [...cards].sort(compareCards).map((c) => c.task.line);
		expect([...cards].sort(compareCards).map((c) => c.task.line)).toEqual(once);
	});

	it('is the same order Today puts a bare task list in', () => {
		const cards = [card({ quadrant: 2 }), card({ quadrant: 1 }), card({ due: '2026-09-01' })];
		expect([...cards].sort(compareCards).map((c) => c.task)).toEqual(
			cards.map((c) => c.task).sort(compareTasks)
		);
	});
});

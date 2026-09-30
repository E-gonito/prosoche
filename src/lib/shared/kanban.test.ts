import { describe, expect, it } from 'vitest';
import { cardAsTask, compareCards, dueLabel, type BoardCard } from './kanban';

describe('dueLabel', () => {
	it.each([
		['2026-09-29', 'Today'],
		['2026-09-30', 'Tomorrow'],
		['2026-09-28', 'Yesterday'],
		['2026-10-02', 'Fri'],
		['2026-10-05', 'Mon'],
		['2026-10-06', '6 Oct'],
		['2026-09-20', '20 Sept'],
		['2027-01-04', '4 Jan 2027']
	])('reads %s as %s on a Tuesday', (due, label) => {
		expect(dueLabel(due, '2026-09-29')).toBe(label);
	});
});

describe('compareCards', () => {
	const card = (line: number, priority: number | null, due: string | null): BoardCard => ({
		line,
		title: `card ${line}`,
		due,
		priority,
		labels: [],
		notes: '',
		done: false
	});

	it('puts priority first, then the soonest due date, then board position', () => {
		const cards = [card(1, null, null), card(2, 2, null), card(3, 2, '2026-10-01'), card(4, 1, null), card(5, null, '2026-09-30')];
		expect([...cards].sort(compareCards).map((c) => c.line)).toEqual([4, 3, 2, 5, 1]);
	});
});

describe('cardAsTask', () => {
	it('carries the card line as the conflict token and nothing it cannot say', () => {
		const card = {
			line: 9,
			title: 'Draft the proposal',
			due: '2000-01-01',
			priority: 2,
			labels: ['client'],
			notes: 'Ask first.',
			done: false,
			workspace: { slug: 'work', name: 'Work', color: '#000' },
			path: 'Work/Board.md',
			hash: 'h',
			column: 'To do',
			raw: '- [ ] Draft the proposal @{2000-01-01} `Q2` #client'
		};
		expect(cardAsTask(card)).toMatchObject({
			path: 'Work/Board.md',
			line: 9,
			raw: card.raw,
			text: 'Draft the proposal',
			startMin: null,
			quadrant: 2,
			status: 'todo'
		});
	});
});

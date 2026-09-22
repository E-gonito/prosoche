/**
 * A workspace's board, assembled from the index.
 *
 * This module answers three questions and hides everything behind them: which
 * columns a workspace has, which of the tasks it claims are cards, and what
 * each card is waiting on. The route and the widget get one object and render
 * it; neither knows about tags, statuses or the index.
 *
 * The pure half of the domain — `columnFor`, `moveEdit`, `isCard`,
 * `compareCards` — lives in `$lib/shared/board`, because the browser has to
 * reach the same conclusions when a card is dragged. They are re-exported
 * here so server code has one board import rather than two.
 */

import { OPEN_STATUSES, type Task } from '../shared/task';
import {
	COLUMN_TAG_PREFIX,
	columnFor,
	compareCards,
	isCard,
	type Board,
	type BoardColumn,
	type Candidate,
	type Column
} from '../shared/board';
import type { TaskStatus } from '../shared/task';
import type { NoteIndex } from './index/index';
import { config } from './config';
import { workspaceFor, type Workspace } from './workspaces';
import { slugify } from '$lib/shared/slug';

export { columnFor, compareCards, isCard, moveEdit } from '../shared/board';
export type { Board, BoardColumn, Candidate, Card, Column, MoveEdit } from '../shared/board';

/** The default board: one column per task status, in the order work moves. */
const STATUS_COLUMNS: readonly Column[] = [
	{ key: 'todo', title: 'To do', status: 'todo', tag: null },
	{ key: 'in-progress', title: 'In progress', status: 'in-progress', tag: null },
	{ key: 'blocked', title: 'Blocked', status: 'blocked', tag: null },
	{ key: 'done', title: 'Done', status: 'done', tag: null },
	{ key: 'cancelled', title: 'Cancelled', status: 'cancelled', tag: null }
];

/**
 * Slugified column titles that name one of the five statuses. Only the status
 * names themselves, plus the American spelling of cancelled: a workspace that
 * writes "Doing" means a column of its own, and guessing that it meant
 * in-progress would start writing `[/]` into lines the user never marked.
 */
const STATUS_BY_SLUG: Record<string, TaskStatus> = {
	todo: 'todo',
	'to-do': 'todo',
	'in-progress': 'in-progress',
	blocked: 'blocked',
	done: 'done',
	cancelled: 'cancelled',
	canceled: 'cancelled'
};

/** How many cards one board will carry before it stops reading the index. */
const CARD_LIMIT = 2000;

/** How many left-out lines the review offers at once, across every note. */
const CANDIDATE_LIMIT = 60;

/**
 * How many of one note's left-out lines the review offers, so a single
 * checklist of four hundred cannot take the whole budget.
 */
const CANDIDATE_LIMIT_PER_NOTE = 20;

/**
 * The columns of a workspace's board.
 *
 * Empty `kanban_columns` gives the five statuses. Otherwise each title that
 * names a status maps to that status, and every other title becomes a
 * `col/<slug>` tag column, so a workspace's own column names never reach the
 * checkbox marker (SPEC 5.2).
 *
 * Never returns an empty list: a workspace whose titles are all unusable gets
 * the default columns, because a board with no columns has nowhere to put a
 * card. Duplicate titles collapse to the first one.
 */
export function columnsFor(workspace: Workspace): Column[] {
	const columns: Column[] = [];
	for (const title of workspace.kanbanColumns) {
		const key = slugify(title);
		if (!key || columns.some((c) => c.key === key)) continue;
		const status = STATUS_BY_SLUG[key] ?? null;
		columns.push({
			key,
			title: title.trim(),
			status,
			tag: status ? null : `${COLUMN_TAG_PREFIX}${key}`
		});
	}
	return columns.length ? columns : STATUS_COLUMNS.map((c) => ({ ...c }));
}

/**
 * Build the whole board for one workspace.
 *
 * Reads the index and nothing else: no filesystem, no writes. `workspaces` is
 * needed to settle ownership — a task inside this workspace's folders that
 * carries another workspace's tag belongs to that one (SPEC 5.1), and showing
 * it here would put the same card on two boards.
 *
 * `_hub/` is always out, since a workspace definition's own checkboxes are not
 * work. The dated daily notes are out too: they are copies of one template, so
 * every past day would contribute the same unfinished checklist, and a time
 * block belongs on Today rather than on a board. Notes that merely live inside
 * `Journal/` are kept, because a workspace is free to put its folder inside
 * the journal folder, and one real vault does.
 *
 * Every other claimed line that `isCard` turns down is reported as excluded
 * rather than dropped, grouped by the note it came from.
 *
 * Cards are sorted for display. The files are never touched or reordered.
 */
export function buildBoard(index: NoteIndex, workspace: Workspace, workspaces: Workspace[]): Board {
	const columns = columnsFor(workspace);
	const { cards, left } = claim(index, workspace, workspaces);
	const blockers = blockerIndex(index, cards);

	const built: BoardColumn[] = columns.map((column) => ({ ...column, cards: [] }));
	const byKey = new Map(built.map((column) => [column.key, column]));
	for (const task of cards) {
		byKey.get(columnFor(task, columns).key)?.cards.push({
			task,
			blockers: task.blockedBy.map((id) => ({ id, task: blockers.get(id) ?? null }))
		});
	}
	for (const column of built) column.cards.sort(compareCards);

	const candidates = groupByNote(index, left);
	return {
		columns: built,
		excluded: candidates.reduce((total, note) => total + note.count, 0),
		candidates,
		deck: workspace.deck
	};
}

/**
 * The open cards of one workspace, in vault order.
 *
 * The same lines the board shows, minus the finished columns. Exported so the
 * rail's count, Today's "From your workspaces" list and the board itself
 * cannot disagree about what a workspace has open: there is one rule, and it
 * is here. Reads the index and nothing else, and never writes.
 */
export function openCards(index: NoteIndex, workspace: Workspace, workspaces: Workspace[]): Task[] {
	const open = new Set<TaskStatus>(OPEN_STATUSES);
	return claim(index, workspace, workspaces).cards.filter((task) => open.has(task.status));
}

/**
 * Every task this workspace owns, split into the cards and the lines left out.
 *
 * One index read and one ownership pass behind both halves, because the board
 * needs the left-out lines to report them and `openCards` needs only the
 * cards; running the filter twice would let the two drift apart.
 *
 * The deck note is asked for by name as well as by folder, so a workspace
 * whose `deck:` points outside its own folders still has a board.
 */
function claim(
	index: NoteIndex,
	workspace: Workspace,
	workspaces: Workspace[]
): { cards: Task[]; left: Task[] } {
	const cards: Task[] = [];
	const left: Task[] = [];
	const claimed = index.findTasks({
		tags: [workspace.tag],
		under: workspace.folders,
		paths: [workspace.deck],
		excludePrefixes: [`${config.hubFolder}/`],
		excludeDailyNotes: true,
		limit: CARD_LIMIT
	});
	for (const task of claimed) {
		if (!ours(task, workspace, workspaces)) continue;
		(isCard(task, workspace) ? cards : left).push(task);
	}
	return { cards, left };
}

/**
 * The lines this workspace claims but does not treat as cards, ready for the
 * "promote to card" review: open ones only, grouped by the note they live in.
 * Every such note is listed with its true count, so the page can say that four
 * hundred lines came from one test plan; only the lines themselves are capped,
 * because nobody reviews four hundred of them in one sitting.
 */
function groupByNote(index: NoteIndex, tasks: Task[]): Candidate[] {
	const open = new Set<TaskStatus>(OPEN_STATUSES);
	const groups = new Map<string, Candidate>();
	let taken = 0;
	for (const task of tasks) {
		if (!open.has(task.status)) continue;
		let group = groups.get(task.path);
		if (!group) {
			group = { path: task.path, title: index.noteTitle(task.path) ?? basename(task.path), count: 0, tasks: [] };
			groups.set(task.path, group);
		}
		group.count++;
		if (taken < CANDIDATE_LIMIT && group.tasks.length < CANDIDATE_LIMIT_PER_NOTE) {
			group.tasks.push(task);
			taken++;
		}
	}
	return [...groups.values()];
}

/** One lookup for every blocker on the board, rather than one per card. */
function blockerIndex(index: NoteIndex, cards: Task[]): Map<string, Task> {
	const ids = [...new Set(cards.flatMap((task) => task.blockedBy))];
	return new Map(index.tasksByIds(ids).flatMap((task) => (task.id ? [[task.id, task] as const] : [])));
}

/**
 * Whether this workspace is the one that owns the task. A task claimed only by
 * folder loses to whichever workspace its tag names, in the order SPEC 5.1
 * fixes. A task no workspace claims is kept: it reached the board by folder, so
 * this is its board.
 */
function ours(task: Task, workspace: Workspace, workspaces: Workspace[]): boolean {
	const owner = workspaceFor(workspaces, { path: task.path, tags: task.tags });
	return owner === null || owner.slug === workspace.slug;
}

function basename(path: string): string {
	return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

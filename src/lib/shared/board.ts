/**
 * The board's vocabulary: what a column is, what a card is, which column a
 * card sits in, and what moving it between two columns changes.
 *
 * It lives in `shared/` because both sides need the same answers. The server
 * builds a board out of the index; the browser drops a card on a column and
 * has to produce exactly the edit the server would have produced, or the two
 * disagree the moment a drag lands. Everything here is pure: no vault, no
 * index, no DOM, no clock.
 *
 * Columns are data rather than an enum because a workspace may name its own
 * (SPEC 5.2). A column either writes a status marker or writes a `col/` tag,
 * never both, so a hub-only column name never leaks into the checkbox.
 */

import { hasTag, type Task, type TaskStatus } from './task';

/** Prefix of the tag that holds a card in a column no status can express. */
export const COLUMN_TAG_PREFIX = 'col/';

export interface Column {
	/** Stable identifier used in URLs, form values and drop-zone ids. */
	key: string;
	title: string;
	/** The status marker this column writes, or null for a tag column. */
	status: TaskStatus | null;
	/** The `col/...` tag this column writes, or null for a status column. */
	tag: string | null;
}

export interface Card {
	task: Task;
	/** One entry per `⛔` id: the blocking task, or null when no task has it. */
	blockers: Array<{ id: string; task: Task | null }>;
}

export interface BoardColumn extends Column {
	cards: Card[];
}

/** The checkbox lines one note contributed that the board left out. */
export interface Candidate {
	path: string;
	title: string;
	/** How many open lines this note had left out, which is the figure shown. */
	count: number;
	/** The first few of them, so the review can offer to promote one. */
	tasks: Task[];
}

export interface Board {
	columns: BoardColumn[];
	/**
	 * How many open checkbox lines the workspace claims by folder were not
	 * treated as cards, which is the total of `candidates`' counts. Reported
	 * rather than hidden: in this vault a `- [ ]` inside a syllabus is
	 * notation, and a board that silently dropped four hundred of them would
	 * be lying about what it knows.
	 */
	excluded: number;
	/** Those lines by note, so the page can name where they came from. */
	candidates: Candidate[];
	/** Note a new card is appended to. */
	deck: string;
}

/** What the `board` widget sends to the browser. */
export interface BoardWidget extends Board {
	/** Null on a page with no workspace, where a board has nothing to show. */
	workspace: { slug: string; name: string } | null;
}

/** The part of a task edit that moving a card between columns produces. */
export interface MoveEdit {
	status?: TaskStatus;
	addTags?: string[];
	removeTags?: string[];
}

/**
 * What the card rule needs to know about a workspace. A server `Workspace`
 * satisfies it structurally; nothing in `shared/` may import that type, and
 * the rule has no use for the rest of it.
 */
export interface CardRule {
	/** Tag that assigns a task to the workspace, without the `#`. */
	tag: string;
	/** Vault-relative path of the note the workspace's cards are written to. */
	deck: string;
}

/**
 * Whether a task the workspace claims is a card on its board.
 *
 * Three ways in. A task carrying the workspace tag is always a card: the user
 * typed the tag, which is intent enough. Every open checkbox in the deck note
 * is a card too, with no metadata at all, because the deck is the board
 * written down — a line put there is already the intent. A task claimed only
 * because its file sits in a workspace folder has to show intent some other
 * way: a quadrant, a due date, an id, or a dependency.
 *
 * The folder rule exists because this vault writes `- [ ]` in syllabus and
 * test-plan notes as plain checklist notation; an earlier version of the Today
 * page listed 463 of them. The deck rule exists because the same strictness
 * applied everywhere left a real project with 414 checkboxes and an empty
 * board. Never promotes a line by itself; it only reads one.
 */
export function isCard(task: Task, workspace: CardRule): boolean {
	return hasTag(task, workspace.tag) || task.path === workspace.deck || showsIntent(task);
}

/** True when the line carries any of the marks this vault uses to mean work. */
export function showsIntent(task: Task): boolean {
	return task.quadrant !== null || task.due !== null || task.id !== null || task.blockedBy.length > 0;
}

/**
 * The column a task belongs in. A `col/` tag wins over the status marker, so
 * a card parked in "Review" stays there while it is ticked in progress; then
 * a status match; then the first column, so a task can never fall off a
 * board. `columns` is assumed non-empty, which `columnsFor` guarantees.
 */
export function columnFor(task: Task, columns: Column[]): Column {
	const tagged = columns.find((c) => c.tag !== null && task.tags.includes(c.tag));
	if (tagged) return tagged;
	return columns.find((c) => c.status !== null && c.status === task.status) ?? columns[0];
}

/**
 * The edit that moves `task` into `column`.
 *
 * Moving to a status column sets the status and takes off every `col/` tag the
 * task carries, because those tags are what held it elsewhere. Moving to a tag
 * column adds that tag, takes off the other `col/` tags, and leaves the status
 * alone: "Review" says nothing about whether the work is done.
 *
 * Returns an edit and nothing else. It never writes, and it is idempotent —
 * applying it to a task already in the column changes no bytes.
 */
export function moveEdit(task: Task, column: Column): MoveEdit {
	const stale = task.tags.filter((tag) => tag.startsWith(COLUMN_TAG_PREFIX) && tag !== column.tag);
	const edit: MoveEdit = {};
	if (column.status !== null) edit.status = column.status;
	if (column.tag !== null && !task.tags.includes(column.tag)) edit.addTags = [column.tag];
	if (stale.length) edit.removeTags = stale;
	return edit;
}

/**
 * Order of work on a screen: most urgent quadrant first, then the soonest due
 * date, then where the line lives, so the order is stable between loads.
 * Tasks without a quadrant or a due date sort last within their group.
 *
 * This is display order only. Nothing here reorders a file.
 *
 * The rule lives here rather than beside the board because Today's list of
 * open cards is the same question asked somewhere else, and two answers to it
 * would show a project's work in one order on its board and another on the
 * day.
 */
export function compareTasks(a: Task, b: Task): number {
	const byQuadrant = rank(a.quadrant) - rank(b.quadrant);
	if (byQuadrant !== 0) return byQuadrant;
	const byDue = (a.due ?? '￿').localeCompare(b.due ?? '￿');
	if (byDue !== 0) return byDue;
	return a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path);
}

/** `compareTasks` for a column of cards, which is what a board sorts. */
export function compareCards(a: Card, b: Card): number {
	return compareTasks(a.task, b.task);
}

/** Identity of a card for keying a list or a patch map. */
export function cardKey(task: Task): string {
	return `${task.path}:${task.line}`;
}

function rank(quadrant: number | null): number {
	return quadrant ?? 9;
}

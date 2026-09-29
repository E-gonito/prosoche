/**
 * The reading list: what a subject has to read, watch or work through, one
 * editable file, `<home>/Reading List.md`.
 *
 * The file is a board in the Obsidian Kanban plugin's format, so every move,
 * edit and delete is the byte-exact operation `parse/kanban.ts` already does
 * for a workspace's `Board.md`, and the list opens as a board in Obsidian.
 * Its columns are the statuses, To read · Reading · Paused · Done, and a
 * missing file reads as those four, empty; the first change writes it. Done
 * is marked `**Complete**`, so an item moved there is ticked, and a plain
 * checklist in Obsidian without the plugin still reads right.
 *
 * An item is a card, and what makes it an item is how its line is written:
 *
 *     - [ ] [CS:APP](https://csapp.cs.cmu.edu) [[Goals#Computer Systems]] #book
 *
 *  - The title is a markdown link to where it is read, or plain words when
 *    there is no link, so the title is what Obsidian shows and clicking it
 *    opens the book.
 *  - The goal is a heading link into the subject's `Goals.md`, so it is
 *    clickable in Obsidian and the item shows among that goal's backlinks.
 *  - The kind is the card's label, `#book`, and `other` is written as no
 *    label at all. It goes last, where the kanban grammar and the plugin
 *    both put labels: `parse/kanban.ts` reads a trailing `#tag` as a label
 *    and edits it in place, so changing the kind rewrites that one tag and
 *    leaves the title, link and goal alone. Put before the goal, a label
 *    would sit inside the card's words and move to the end on its first edit.
 *
 * This module is the only place that knows that line shape; the parts that
 * read and write it are pure and table-tested.
 */

import { changeBoardFile, readBoardFile, type BoardFile } from '../kanban';
import { emptyBoard, type KanbanCard } from '../parse/kanban';
import { goalLink, goalOf } from './goals';
import {
	READING_COLUMNS,
	READING_KINDS,
	type ReadingFields,
	type ReadingItem,
	type ReadingKind,
	type ReadingList,
	type ReadingOp
} from '$lib/shared/study';
import type { BoardOp } from '$lib/shared/kanban';
import type { Subject } from './subjects';
import type { Vault } from '../vault/index';

export type { ReadingItem, ReadingList, ReadingOp };

/** What a subject's reading list is before it has been written. */
export const DEFAULT_READING_LIST = emptyBoard(READING_COLUMNS, 'Done');

/**
 * One card as a reading item. Pure.
 *
 * Reads the card's words (the kanban grammar has already taken its due
 * date, priority and labels out): a trailing `[[Goals#…]]` is the goal, a
 * whole `[title](url)` is the title and link, and a lone URL is both. Any
 * other words are the title as written. The kind is the first label that
 * names one, whatever its case; none is `other`.
 */
export function readItem(card: Pick<KanbanCard, 'line' | 'title' | 'labels' | 'done'>): ReadingItem {
	let words = card.title;
	let goal: string | null = null;
	const trailing = /\s*\[\[([^[\]]+)\]\]$/.exec(words);
	if (trailing && goalOf(trailing[1])) {
		goal = goalOf(trailing[1]);
		words = words.slice(0, trailing.index);
	}

	let title = words.trim();
	let url: string | null = null;
	const link = /^\[((?:\\.|[^\\\]])*)\]\((?:<([^>]*)>|([^\s()]+))\)$/.exec(title);
	if (link) {
		title = link[1].replace(/\\([[\]\\])/g, '$1').trim();
		url = link[2] ?? link[3];
	} else if (/^https?:\/\/\S+$/.test(title)) {
		url = title;
	}

	return { line: card.line, done: card.done, title: title || url || '', url, kind: kindOf(card.labels), goal };
}

/**
 * An item's words, as `readItem` reads them back: the title, as a link when
 * there is a URL, then the goal link. The kind is not here; it is the card's
 * label (see `kindLabels`). Pure.
 *
 * Brackets in a linked title are escaped so they cannot close the link, and
 * a URL with a space or a bracket is written in `<…>`, which markdown
 * allows for exactly that.
 */
export function itemWords(fields: Pick<ReadingFields, 'title' | 'url' | 'goal'>): string {
	const title = oneLine(fields.title);
	const url = oneLine(fields.url ?? '');
	const target = /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, '')}>` : url;
	const shown = title || url;
	// A web link with no title of its own is written bare, as it was typed.
	const bare = shown === url && /^https?:\/\/[^\s()<>]+$/.test(url);
	const head = !url ? title : bare ? url : `[${shown.replace(/([[\]\\])/g, '\\$1')}](${target})`;
	const goal = oneLine(fields.goal ?? '');
	return goal ? `${head} ${goalLink(goal)}` : head;
}

/**
 * A card's labels with its kind set to `kind`: every other label kept in
 * order, any label naming a kind dropped, and `kind` appended unless it is
 * `other`. Pure.
 */
export function kindLabels(labels: string[], kind: ReadingKind): string[] {
	const kept = labels.filter((l) => !isKind(l));
	return kind === 'other' ? kept : [...kept, kind];
}

/**
 * The board op that carries out a reading-list op against `file`, or a
 * refusal. Pure.
 *
 * An edit sends only what changed — the words when the title, link or goal
 * did, the labels when the kind did — so an edit that changes nothing
 * rewrites nothing.
 */
export function toBoardOp(file: BoardFile, op: ReadingOp): { ok: true; op: BoardOp | null } | { ok: false; message: string } {
	switch (op?.kind) {
		case 'add': {
			const fields = cleanFields(op.item);
			if (!fields) return { ok: false, message: 'An item needs a title or a link.' };
			const words = [itemWords(fields), ...(fields.kind === 'other' ? [] : [`#${fields.kind}`])].join(' ');
			return { ok: true, op: { kind: 'add-card', column: op.group, text: words, literal: true } };
		}
		case 'edit': {
			const card = file.board.columns.flatMap((c) => c.cards).find((c) => c.line === op.line);
			const fields = cleanFields(op.item);
			if (!card) return { ok: false, message: 'That item is not on the list any more.' };
			if (!fields) return { ok: false, message: 'An item needs a title or a link.' };
			const now = readItem(card);
			const words = itemWords(fields) !== itemWords(now) ? itemWords(fields) : undefined;
			const labels = fields.kind !== now.kind ? kindLabels(card.labels, fields.kind) : undefined;
			if (words === undefined && labels === undefined) return { ok: true, op: null };
			return { ok: true, op: { kind: 'edit-card', line: op.line, title: words, labels } };
		}
		case 'move':
			return { ok: true, op: { kind: 'move-card', line: op.line, column: op.group, index: op.index } };
		case 'delete':
			return { ok: true, op: { kind: 'delete-card', line: op.line } };
		default:
			return { ok: false, message: 'That is not something a reading list can do.' };
	}
}

/**
 * A subject's reading list. A missing or blank file reads as the four
 * default columns, empty, with `exists: false`. Never writes, never throws.
 */
export async function readReadingList(vault: Vault, subject: Subject): Promise<ReadingList> {
	return toList(subject, await readBoardFile(vault, subject.files.reading, DEFAULT_READING_LIST));
}

export type ReadingChange =
	| { ok: true; list: ReadingList }
	/** The file changed since `hash` was read. Nothing was written; `list` is what is there now. */
	| { ok: false; reason: 'conflict'; list: ReadingList }
	/** The op made no sense against this list. Nothing was written. */
	| { ok: false; reason: 'refused'; message: string; list: ReadingList };

/**
 * Apply one op to a subject's reading list, as the caller saw it at `hash`.
 *
 * Side effects: at most one write, of `Reading List.md` alone, through
 * `changeBoardFile`, which refuses a stale hash and writes the default
 * columns with the change applied when the file is new. Never touches any
 * line the op does not concern.
 */
export async function changeReadingList(vault: Vault, subject: Subject, hash: string, op: ReadingOp): Promise<ReadingChange> {
	const path = subject.files.reading;
	const file = await readBoardFile(vault, path, DEFAULT_READING_LIST);
	if (file.hash !== hash) return { ok: false, reason: 'conflict', list: toList(subject, file) };

	const translated = toBoardOp(file, op);
	if (!translated.ok) return { ok: false, reason: 'refused', message: translated.message, list: toList(subject, file) };
	if (!translated.op) return { ok: true, list: toList(subject, file) };

	const result = await changeBoardFile(vault, path, hash, translated.op, { fallback: DEFAULT_READING_LIST });
	const list = toList(subject, result.file);
	if (result.ok) return { ok: true, list };
	if (result.reason === 'conflict') return { ok: false, reason: 'conflict', list };
	return { ok: false, reason: 'refused', message: result.message, list };
}

function toList(subject: Subject, file: BoardFile): ReadingList {
	return {
		subject: subject.slug,
		path: file.path,
		hash: file.hash,
		exists: file.exists,
		groups: file.board.columns.map((c) => ({ title: c.title, items: c.cards.map(readItem) }))
	};
}

function kindOf(labels: string[]): ReadingKind {
	const found = labels.find(isKind)?.toLowerCase();
	return (found as ReadingKind | undefined) ?? 'other';
}

function isKind(label: string): boolean {
	const lower = label.toLowerCase();
	return lower !== 'other' && (READING_KINDS as readonly string[]).includes(lower);
}

/** Fields off the wire, tidied: a kind it does not know is `other`. Null when there is nothing to call it. */
function cleanFields(item: Partial<ReadingFields> | undefined): ReadingFields | null {
	const title = oneLine(typeof item?.title === 'string' ? item.title : '');
	const url = oneLine(typeof item?.url === 'string' ? item.url : '') || null;
	if (!title && !url) return null;
	const kind = (READING_KINDS as readonly string[]).includes(item?.kind as string) ? (item!.kind as ReadingKind) : 'other';
	const goal = oneLine(typeof item?.goal === 'string' ? item.goal : '') || null;
	return { title: title || url!, url, kind, goal };
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

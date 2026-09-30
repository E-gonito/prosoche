/**
 * Boards: reading one, changing one, and gathering the open cards from every
 * workspace's.
 *
 * A board is a file in the format `parse/kanban.ts` owns. This module is what
 * connects that grammar to the vault: it decides what a missing file reads
 * as, and how a change is guarded against an edit made somewhere else in the
 * meantime. A workspace's board is `<home>/Board.md`; the study reading list
 * is another board in the same format, which is why the file-level half,
 * `readBoardFile` and `changeBoardFile`, takes a path rather than a
 * workspace. Routes, Today and Study talk to this and never to the grammar or
 * the file.
 *
 * Two interfaces were considered. One function per operation (`addCard`,
 * `moveCard`, `renameColumn` …) reads well at a call site but repeats the
 * same read, check, apply and write eight times, and every new operation
 * widens the module. One `changeBoard` taking an op keeps the interface to
 * three functions, and the list of operations lives in one union type that
 * the browser shares; that is the one here.
 */

import { applyOp, DEFAULT_BOARD, parseBoard, type KanbanBoard, type OpResult } from './parse/kanban';
import { today as todayKey, type DayKey } from './daily';
import { homeFolder, type Workspace } from './workspaces';
import type { Board, BoardOp, OpenCard } from '$lib/shared/kanban';
import type { Vault } from './vault/index';

export type { Board, BoardOp, OpenCard };

/** A board file as read: where it is, the hash to send back with a change, and what it holds. */
export interface BoardFile {
	path: string;
	hash: string;
	/** False for a missing or blank file, which reads as the fallback board. */
	exists: boolean;
	board: KanbanBoard;
}

/** Why a change was not written, when it was not. */
type BoardRefusal = Exclude<OpResult, { ok: true }>['reason'];

type BoardFileChange =
	| { ok: true; file: BoardFile }
	/** The file changed since `hash` was read. Nothing was written; `file` is what is there now. */
	| { ok: false; reason: 'conflict'; file: BoardFile }
	/** The op made no sense against this board. Nothing was written. */
	| { ok: false; reason: BoardRefusal; message: string; file: BoardFile };

type BoardChange =
	| { ok: true; board: Board }
	| { ok: false; reason: 'conflict'; board: Board }
	| { ok: false; reason: BoardRefusal; message: string; board: Board };

/**
 * A board file, read from the vault.
 *
 * A missing or blank file reads as `fallback` — an empty board in the
 * plugin's format, To do, Doing and Done unless the caller names its own —
 * with `exists: false`, so there is a board to add to without anything being
 * written. Never writes and never throws.
 */
export async function readBoardFile(vault: Vault, path: string, fallback = DEFAULT_BOARD): Promise<BoardFile> {
	const note = await vault.read(path);
	return toFile(path, note.hash, note, fallback);
}

/**
 * Apply one operation to a board file, as the caller saw it.
 *
 * `hash` is the `BoardFile.hash` the op was computed against. When the file
 * has changed since — here, in Obsidian, on another device — nothing is
 * written and the current file comes back as a conflict, because a line
 * number from an older read could name a different card now. The first change
 * to a missing file writes `fallback` with that change applied.
 *
 * Side effects: at most one write, of `path` alone. Never rewrites any part
 * of the file the op does not concern (see `parse/kanban.ts`), and never
 * touches another note.
 */
export async function changeBoardFile(
	vault: Vault,
	path: string,
	hash: string,
	op: BoardOp,
	{ fallback = DEFAULT_BOARD, day = todayKey() }: { fallback?: string; day?: DayKey } = {}
): Promise<BoardFileChange> {
	const note = await vault.read(path);
	const current = toFile(path, note.hash, note, fallback);
	if (note.hash !== hash) return { ok: false, reason: 'conflict', file: current };

	const applied = applyOp(effective(note, fallback), op, day);
	if (!applied.ok) return { ok: false, reason: applied.reason, message: applied.message, file: current };

	const written = await vault.write(path, applied.content, note.hash);
	if (!written.ok) return { ok: false, reason: 'conflict', file: toFile(path, written.current.hash, written.current, fallback) };
	return { ok: true, file: toFile(path, written.note.hash, written.note, fallback) };
}

/** Vault-relative path of a workspace's board: `<home>/Board.md`. */
export function boardPath(workspace: Workspace): string {
	return `${homeFolder(workspace)}/Board.md`;
}

/**
 * A workspace's board, as the browser sees it. A missing board is To do,
 * Doing and Done with no cards and `exists: false`. Never writes and never
 * throws.
 */
export async function readBoard(vault: Vault, workspace: Workspace): Promise<Board> {
	return toBoard(workspace, await readBoardFile(vault, boardPath(workspace)));
}

/**
 * Apply one operation to a workspace's board: `changeBoardFile` on
 * `<home>/Board.md`, answered as the browser's `Board`.
 */
export async function changeBoard(
	vault: Vault,
	workspace: Workspace,
	hash: string,
	op: BoardOp,
	day: DayKey = todayKey()
): Promise<BoardChange> {
	const result = await changeBoardFile(vault, boardPath(workspace), hash, op, { day });
	const board = toBoard(workspace, result.file);
	if (result.ok) return { ok: true, board };
	if (result.reason === 'conflict') return { ok: false, reason: 'conflict', board };
	return { ok: false, reason: result.reason, message: result.message, board };
}

/**
 * Every unticked card on every workspace's board, in workspace order and then
 * board order, each carrying its workspace, its column and its board's hash
 * so Today can show it and tick it.
 *
 * Reads one file per workspace and never writes. A workspace with no board
 * contributes nothing, not the default board's nothing-in-particular.
 */
export async function openCards(vault: Vault, workspaces: Workspace[]): Promise<OpenCard[]> {
	const notes = await Promise.all(workspaces.map((w) => vault.read(boardPath(w))));
	return notes.flatMap((note, i) => {
		const w = workspaces[i];
		const board = toBoard(w, toFile(note.path, note.hash, note, DEFAULT_BOARD));
		const lines = note.content.split('\n');
		return board.columns.flatMap((column) =>
			column.cards
				.filter((card) => !card.done)
				.map((card) => ({
					...card,
					workspace: { slug: w.slug, name: w.name, color: w.color },
					path: board.path,
					hash: board.hash,
					raw: lines[card.line] ?? '',
					column: column.title
				}))
		);
	});
}

/** What the grammar reads: the file, or the fallback in place of a missing or blank one. */
function effective(note: { exists: boolean; content: string }, fallback: string): string {
	return note.exists && note.content.trim() !== '' ? note.content : fallback;
}

function toFile(path: string, hash: string, note: { exists: boolean; content: string }, fallback: string): BoardFile {
	return { path, hash, exists: note.exists && note.content.trim() !== '', board: parseBoard(effective(note, fallback)) };
}

function toBoard(workspace: Workspace, file: BoardFile): Board {
	return {
		workspace: workspace.slug,
		path: file.path,
		hash: file.hash,
		exists: file.exists,
		columns: file.board.columns.map((column) => ({
			title: column.title,
			limit: column.limit,
			complete: column.complete,
			cards: column.cards.map((card) => ({
				line: card.line,
				title: card.title,
				due: card.due,
				priority: card.priority,
				labels: card.labels,
				notes: card.notes,
				done: card.done
			}))
		}))
	};
}

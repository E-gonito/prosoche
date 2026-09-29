/**
 * Workspace boards: reading one, changing one, and gathering the open cards
 * from all of them.
 *
 * A board is `<home>/Board.md`, in the format `parse/kanban.ts` owns. This
 * module is what connects that grammar to the vault: it decides where the file
 * is, what a missing one reads as, and how a change is guarded against an
 * edit made somewhere else in the meantime. Routes and Today talk to this and
 * never to the grammar or the file.
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

export type BoardChange =
	| { ok: true; board: Board }
	/** The file changed since `hash` was read. Nothing was written; `board` is what is there now. */
	| { ok: false; reason: 'conflict'; board: Board }
	/** The op made no sense against this board. Nothing was written. */
	| { ok: false; reason: Exclude<OpResult, { ok: true }>['reason']; message: string; board: Board };

/** Vault-relative path of a workspace's board: `<home>/Board.md`. */
export function boardPath(workspace: Workspace): string {
	return `${homeFolder(workspace)}/Board.md`;
}

/**
 * A workspace's board, read from the vault.
 *
 * A missing or blank file reads as the default board — To do, Doing, Done,
 * no cards — with `exists: false`, so a new workspace has a board to add to
 * without anything being written. Never writes and never throws.
 */
export async function readBoard(vault: Vault, workspace: Workspace): Promise<Board> {
	const note = await vault.read(boardPath(workspace));
	return toBoard(workspace, note.hash, note.exists && note.content.trim() !== '', effective(note));
}

/**
 * Apply one operation to a workspace's board, as the caller saw it.
 *
 * `hash` is the `Board.hash` the op was computed against. When the file has
 * changed since — here, in Obsidian, on another device — nothing is written
 * and the current board comes back as a conflict, because a line number from
 * an older read could name a different card now. The first change to a
 * missing board writes the default board with that change applied.
 *
 * Side effects: at most one write, of `Board.md` alone. Never rewrites any
 * part of the file the op does not concern (see `parse/kanban.ts`), and never
 * touches another note.
 */
export async function changeBoard(
	vault: Vault,
	workspace: Workspace,
	hash: string,
	op: BoardOp,
	day: DayKey = todayKey()
): Promise<BoardChange> {
	const path = boardPath(workspace);
	const note = await vault.read(path);
	const current = () => toBoard(workspace, note.hash, note.exists && note.content.trim() !== '', effective(note));
	if (note.hash !== hash) return { ok: false, reason: 'conflict', board: current() };

	const applied = applyOp(effective(note), op, day);
	if (!applied.ok) return { ok: false, reason: applied.reason, message: applied.message, board: current() };

	const written = await vault.write(path, applied.content, note.hash);
	if (!written.ok) {
		return { ok: false, reason: 'conflict', board: toBoard(workspace, written.current.hash, true, written.current.content) };
	}
	return { ok: true, board: toBoard(workspace, written.note.hash, true, written.note.content) };
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
	const boards = await Promise.all(workspaces.map((w) => readBoard(vault, w)));
	return boards.flatMap((board, i) => {
		const w = workspaces[i];
		return board.columns.flatMap((column) =>
			column.cards
				.filter((card) => !card.done)
				.map((card) => ({
					...card,
					workspace: { slug: w.slug, name: w.name, color: w.color },
					path: board.path,
					hash: board.hash,
					column: column.title
				}))
		);
	});
}

/** What the grammar reads: the file, or the default board in place of a missing or blank one. */
function effective(note: { exists: boolean; content: string }): string {
	return note.exists && note.content.trim() !== '' ? note.content : DEFAULT_BOARD;
}

function toBoard(workspace: Workspace, hash: string, exists: boolean, content: string): Board {
	const parsed: KanbanBoard = parseBoard(content);
	return {
		workspace: workspace.slug,
		path: boardPath(workspace),
		hash,
		exists,
		columns: parsed.columns.map((column) => ({
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

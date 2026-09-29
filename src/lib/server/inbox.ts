/**
 * Filing one inbox line as a card.
 *
 * A capture is a bullet, either already a task (`parse/task.ts` recognises
 * it) or a plain timestamped line `capture.ts` wrote. "Make it a task" adds
 * its words as a card in the first column of the workspace's board, through
 * `kanban.ts`, so the words are read the way quick-add reads them (`Q1`,
 * `#label`, a due word). The inbox line itself is never deleted, only marked
 * done in place, so the inbox stays a true record of what came in and what
 * has since been filed.
 */

import { changeBoard, readBoard } from './kanban';
import { homeFolder, type Workspace } from './workspaces';
import { parseTaskLine, rewriteTaskLine, toTask } from './parse/task';
import type { Task } from '$lib/shared/task';
import type { Vault } from './vault/index';

/** A bullet, with or without a checkbox: group 4 is everything after it. */
const BULLET = /^([ \t]*)([-*+])([ \t]+)(?:\[.\][ \t]+)?(.*)$/;
const PLAIN_BULLET = /^([ \t]*)([-*+])([ \t]+)(.*)$/;
const BULLET_CHECKBOX = /^[ \t]*[-*+][ \t]+\[(.)\][ \t]/;

/**
 * How many capture lines in an inbox note are still unfiled: every bullet
 * whose checkbox is not `x`, plus every bullet with no checkbox at all — a
 * line only reads as filed once `fileInboxLine` ticks it.
 */
export function openInboxCount(content: string): number {
	let count = 0;
	for (const raw of content.split('\n')) {
		if (!PLAIN_BULLET.test(raw)) continue;
		const box = BULLET_CHECKBOX.exec(raw);
		if (box && box[1].toLowerCase() === 'x') continue;
		count++;
	}
	return count;
}

/** One capture, ready for the Inbox page to render and act on. */
export interface InboxLine {
	line: number;
	raw: string;
	/** Present when the line is already a task: tick it through `/api/task`. */
	task: Task | null;
	/** True once ticked, whichever way this module or `/api/task` ticks it. */
	done: boolean;
	/** The words, with the bullet and any checkbox stripped. */
	text: string;
}

/**
 * Every capture in an inbox note, in file order. Headings and blank lines are
 * left out; the day a line was captured under is not carried here, since the
 * page shows the whole file as one list.
 */
export function listInboxLines(content: string, path: string): InboxLine[] {
	const lines = content.split('\n');
	const out: InboxLine[] = [];
	lines.forEach((raw, line) => {
		const task = parseTaskLine(raw, line);
		if (task) {
			out.push({ line, raw, task: toTask(task, path), done: task.status === 'done' || task.status === 'cancelled', text: task.text });
			return;
		}
		const m = PLAIN_BULLET.exec(raw);
		if (!m) return;
		// A checkbox bullet is always caught by `parseTaskLine` above, so a
		// line reaching here has none: it is never done until `fileInboxLine`
		// ticks it, at which point it becomes a task line instead.
		out.push({ line, raw, task: null, done: false, text: m[4].trim() });
	});
	return out;
}

export type Filed =
	| { ok: true; path: string }
	| { ok: false; reason: 'no-note' | 'no-text' | 'line-changed' | 'no-column' };

/**
 * File the inbox line at `line` of the workspace's `Inbox.md` as a card in
 * the first column of its `Board.md`, and tick the inbox line.
 *
 * Guarded per line, the same way `updateTask` guards a task edit: when the
 * inbox line no longer matches `expectedRaw`, nothing is written. Refuses
 * before writing anything when the line carries no words at all, so an
 * accidental click on a blank line cannot create an empty card, and when the
 * board has no column to put it in. A missing board is created as the
 * default one. Writes the board first and the inbox second, so a failure
 * between the two leaves the line unticked: the worst case is a card filed
 * twice, never a capture lost.
 */
export async function fileInboxLine(vault: Vault, workspace: Workspace, line: number, expectedRaw: string): Promise<Filed> {
	const inboxPath = `${homeFolder(workspace)}/Inbox.md`;
	const inbox = await vault.read(inboxPath);
	if (!inbox.exists) return { ok: false, reason: 'no-note' };

	const lines = inbox.content.split('\n');
	const current = lines[line] ?? null;
	if (current !== expectedRaw) return { ok: false, reason: 'line-changed' };

	const words = wordsOf(current);
	if (!words) return { ok: false, reason: 'no-text' };

	const board = await readBoard(vault, workspace);
	if (board.columns.length === 0) return { ok: false, reason: 'no-column' };
	const filed = await changeBoard(vault, workspace, board.hash, { kind: 'add-card', column: 0, text: words });
	if (!filed.ok) return { ok: false, reason: 'line-changed' };

	lines[line] = tick(current);
	const inboxResult = await vault.write(inboxPath, lines.join('\n'), inbox.hash);
	if (!inboxResult.ok) return { ok: false, reason: 'line-changed' };

	return { ok: true, path: board.path };
}

/**
 * The words an inbox line would carry as a card: everything after the bullet
 * (and its checkbox, when it has one), less the `HH:MM` stamp `capture.ts`
 * puts in front, which says when it was captured, not what it is. Null for a
 * bullet with no words at all.
 */
function wordsOf(raw: string): string | null {
	const m = BULLET.exec(raw);
	return m ? m[4].trim().replace(/^\d{1,2}:\d{2}[ \t]+/, '') || null : null;
}

/**
 * Mark the line done in place. A line already written as a task is ticked
 * through the one rewriter that knows the task grammar; a plain bullet gets a
 * checkbox added, already ticked, so it reads as filed without losing a word
 * of what was captured.
 */
function tick(raw: string): string {
	const task = parseTaskLine(raw);
	if (task) return rewriteTaskLine(raw, { status: 'done' });
	const m = PLAIN_BULLET.exec(raw);
	if (!m) return raw;
	const [, indent, marker, , rest] = m;
	return `${indent}${marker} [x] ${rest}`;
}

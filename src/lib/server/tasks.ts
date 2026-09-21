/**
 * Changing a task in the vault.
 *
 * A task edit is a one-line change, and this module keeps it that way. It
 * locates the line, checks it is still the line the caller thought it was,
 * rewrites that line alone, and writes the file back.
 *
 * Concurrency is guarded per line rather than per file, deliberately. Ticking
 * a task should not fail because a different part of the note changed on
 * another device; it should fail only if that task itself changed. Whole-note
 * saves use the file hash instead, in `Vault.write`.
 */

import { parseTaskLine, rewriteTaskLine, toTask, type TaskEdit, type TaskLine } from './parse/task';
import type { Task } from '$lib/shared/task';
import type { Vault } from './vault/index';

export type TaskUpdate =
	| { ok: true; task: Task }
	| { ok: false; reason: 'no-note' }
	| { ok: false; reason: 'not-a-task' }
	| { ok: false; reason: 'line-changed'; current: string | null };

/**
 * Apply `edit` to the task at `line` in `path`.
 *
 * `expectedRaw` is the line as the caller last saw it. When it no longer
 * matches, nothing is written and the current line comes back so the UI can
 * refresh instead of overwriting someone else's change.
 */
export async function updateTask(
	vault: Vault,
	path: string,
	line: number,
	expectedRaw: string,
	edit: TaskEdit
): Promise<TaskUpdate> {
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'no-note' };

	const lines = note.content.split('\n');
	const current = lines[line] ?? null;
	if (current !== expectedRaw) return { ok: false, reason: 'line-changed', current };
	if (!parseTaskLine(current, line)) return { ok: false, reason: 'not-a-task' };

	const rewritten = rewriteTaskLine(current, edit);
	if (rewritten === current) {
		return { ok: true, task: toTask(parseTaskLine(current, line)!, path) };
	}

	lines[line] = rewritten;
	const result = await vault.write(path, lines.join('\n'), note.hash);
	if (!result.ok) return { ok: false, reason: 'line-changed', current: null };

	return { ok: true, task: toTask(parseTaskLine(rewritten, line)!, path) };
}

/**
 * Move a task's block to a new position in the same note, carrying its
 * indented sub-bullets with it. Used when a time block is dragged past
 * another on the timeline and the user asks to reorder.
 *
 * Not wired to the timeline: dragging changes the time range in place and
 * leaves the file order alone, per the project's no-reordering rule. This
 * exists for an explicit "reorder" action only.
 */
export function moveBlock(content: string, task: TaskLine, beforeLine: number): string {
	const lines = content.split('\n');
	const block = lines.slice(task.line, task.blockEnd + 1);
	const rest = [...lines.slice(0, task.line), ...lines.slice(task.blockEnd + 1)];
	const target = beforeLine > task.blockEnd ? beforeLine - block.length : beforeLine;
	rest.splice(Math.max(0, Math.min(target, rest.length)), 0, ...block);
	return rest.join('\n');
}

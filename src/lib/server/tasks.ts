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

import { parseTaskLine, rewriteTaskLine, scanTasks, toTask, type TaskEdit, type TaskLine } from './parse/task';
import { parseNote } from './parse/note';
import { workspaceFor, type Workspace } from './workspaces';
import type { CardContext, Task } from '$lib/shared/task';
import type { NoteIndex } from './index/index';
import type { Vault } from './vault/index';

type TaskUpdate =
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
 * One task with what the card drawer shows around it: its sub-bullets, its
 * note's title, the workspace it belongs to by tag, folder or alias, and every
 * workspace with the tag that assigns a card to it.
 *
 * Reads the vault rather than the index, because the drawer is about to edit
 * the line and must show the bytes that are there now. Writes nothing. A
 * missing note or a line that is no longer a task is a `not-found` with a
 * sentence to show.
 */
export async function cardContext(
	vault: Vault,
	index: NoteIndex,
	workspaces: Workspace[],
	path: string,
	line: number
): Promise<({ ok: true } & CardContext) | { ok: false; reason: 'not-found'; message: string }> {
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'not-found', message: `There is no note at ${path}.` };
	const found = scanTasks(note.content).find((task) => task.line === line);
	if (!found) return { ok: false, reason: 'not-found', message: `Line ${line + 1} of ${path} is not a task any more.` };

	const parsed = parseNote(note.content, path);
	const owner = workspaceFor(workspaces, { path, tags: found.tags, frontmatter: parsed.frontmatter, text: found.text });
	return {
		ok: true,
		task: toTask(found, path),
		block: note.content.split('\n').slice(found.line + 1, found.blockEnd + 1),
		title: index.noteTitle(path) ?? parsed.title,
		workspace: owner ? { slug: owner.slug, name: owner.name, color: owner.color } : null,
		// Which tag means which workspace stays a question for this module; the
		// drawer writes the tag it is given.
		workspaces: workspaces.map((w) => ({ slug: w.slug, name: w.name, color: w.color, tag: w.tag }))
	};
}

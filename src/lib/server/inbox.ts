/**
 * The one inbox, `Inbox/Capture.md`, read back and triaged.
 *
 * `capture.ts` writes the file; this module reads it for Today's Inbox card,
 * the `/inbox` triage page and each workspace's Inbox tab (the same list,
 * filtered to lines carrying the workspace's tag or an alias word), and gives
 * each unfiled line its five exits:
 *
 *  - **plan** it onto a day, as a linked block through `day-plan.ts`;
 *  - **file** it as a card on a workspace's board, read the way quick-add
 *    reads it (`Q1`, `#label`, a due word);
 *  - **note** it: append its words as a bullet to the end of a workspace's
 *    `Overview.md`, for a thought that belongs to the project rather than
 *    to its to-do list;
 *  - **study** it: add it to a study subject's reading list, under To read,
 *    for something to read, watch or work through;
 *  - **drop** it.
 *
 * All five tick the inbox line in place, so the file stays a true record of
 * what came in and what has since been dealt with, and the row leaves the
 * list. Nothing is ever deleted. Every exit is guarded by the line as the
 * caller last saw it, the way `updateTask` guards a task edit.
 */

import { CAPTURE_PATH } from './capture';
import { addToDay } from './day-plan';
import { dailyNotePath, type DayKey } from './daily';
import { changeBoard, readBoard } from './kanban';
import { changeReadingList, readReadingList } from './study/reading';
import type { Subject } from './study/subjects';
import { homeFolder, workspaceFor, type Workspace } from './workspaces';
import { parseTaskLine, rewriteTaskLine, toTask } from './parse/task';
import { scanTags } from './parse/note';
import type { InboxLine } from '$lib/shared/inbox';
import type { Vault } from './vault/index';

export type { InboxLine };

/** A bullet, with or without a checkbox: group 4 is everything after it. */
const BULLET = /^([ \t]*)([-*+])([ \t]+)(?:\[.\][ \t]+)?(.*)$/;
const PLAIN_BULLET = /^([ \t]*)([-*+])([ \t]+)(.*)$/;
const DAY_HEADING = /^##[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;
/** The `HH:MM` stamp `capture.ts` writes in front of a bare line. */
const STAMP = /^(\d{1,2}:\d{2})[ \t]+(.*)$/;

/**
 * Every capture in an inbox note, in file order, each with the `## <day>`
 * heading it sits under. Headings and blank lines are left out. A bullet
 * with no checkbox is never done: it reads as dealt with only once an exit
 * here ticks it, at which point it is a task line. Pure.
 */
export function listInboxLines(content: string, path: string): InboxLine[] {
	const out: InboxLine[] = [];
	let day: string | null = null;
	content.split('\n').forEach((raw, line) => {
		const heading = DAY_HEADING.exec(raw);
		if (heading) {
			day = heading[1];
			return;
		}
		const task = parseTaskLine(raw, line);
		const words = task ? task.text : PLAIN_BULLET.exec(raw)?.[4].trim();
		if (words === undefined) return;
		const stamp = STAMP.exec(words);
		out.push({
			line,
			raw,
			task: task ? toTask(task, path) : null,
			done: task ? task.status === 'done' || task.status === 'cancelled' : false,
			text: stamp ? stamp[2] : words,
			stamp: stamp ? stamp[1] : null,
			day
		});
	});
	return out;
}

/**
 * The unfiled lines in triage order: newest day first, and within a day in
 * the order they were written, so a morning's captures read as a morning.
 * With `newestFirst`, strictly the latest capture first, for a card that
 * shows only a handful. Lines above any day heading come last. Pure.
 */
export function unfiled(lines: InboxLine[], options: { newestFirst?: boolean } = {}): InboxLine[] {
	const within = options.newestFirst ? -1 : 1;
	return lines
		.filter((l) => !l.done)
		.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '') || within * (a.line - b.line));
}

/**
 * Whether `line` belongs to `workspace`, by the rule every other line in the
 * vault is attributed with: its tag, else an alias word in its words
 * (`workspaceFor`, with no folder, since every capture shares one file).
 * `workspaces` is all of them, so a line tagged for one workspace and
 * mentioning another's alias is only the tagged one's. Pure.
 */
export function belongsTo(line: InboxLine, workspaces: Workspace[], workspace: Workspace): boolean {
	const tags = line.task?.tags ?? scanTags(line.text).map((t) => t.tag);
	return workspaceFor(workspaces, { path: '', tags, text: line.text })?.slug === workspace.slug;
}

/**
 * `Inbox/Capture.md`, listed. A missing file is an empty inbox. Reads one
 * file and never writes.
 */
export async function readInbox(vault: Vault): Promise<InboxLine[]> {
	return listInboxLines((await vault.read(CAPTURE_PATH)).content, CAPTURE_PATH);
}

/**
 * The open lines of a workspace's old `<home>/Inbox.md`, which nothing
 * writes any more, so its tab can list them read-only until they are dealt
 * with in Obsidian. Empty when the file is gone or fully ticked.
 */
export async function legacyInbox(vault: Vault, workspace: Workspace): Promise<{ path: string; lines: InboxLine[] }> {
	const path = `${homeFolder(workspace)}/Inbox.md`;
	return { path, lines: unfiled(listInboxLines((await vault.read(path)).content, path)) };
}

export type Triaged =
	| { ok: true; path: string }
	| { ok: false; reason: 'no-note' | 'no-text' | 'line-changed' | 'no-column' | 'no-day' };

/**
 * File the inbox line at `line` as a card in the first column of the
 * workspace's `Board.md`, and tick the inbox line. Answers the board's path.
 *
 * Refuses before writing anything when the line is not the one the caller
 * saw, when it has no words (so a stray click cannot make an empty card), or
 * when the board has no column. A missing board is created as the default
 * one. Writes the board first and the inbox second, so a failure between the
 * two leaves the line unticked: the worst case is a card filed twice, never
 * a capture lost. The capture time and the workspace's own tag are left off
 * the card.
 */
export async function fileInboxLine(vault: Vault, workspace: Workspace, line: number, expectedRaw: string): Promise<Triaged> {
	const found = await lineAt(vault, line, expectedRaw);
	if (!found.ok) return found;

	const board = await readBoard(vault, workspace);
	if (board.columns.length === 0) return { ok: false, reason: 'no-column' };
	// On its own board a card needs no tag saying whose it is.
	const words = found.words.split(' ').filter((w) => w !== `#${workspace.tag}`).join(' ');
	const filed = await changeBoard(vault, workspace, board.hash, { kind: 'add-card', column: 0, text: words });
	if (!filed.ok) return { ok: false, reason: 'line-changed' };

	return tickLine(vault, line, expectedRaw, board.path);
}

/**
 * Plan the inbox line at `line` onto `day` as a block with no time, and
 * tick the inbox line. Answers the day's note.
 *
 * A bare bullet is first rewritten in place as a task line, its words kept
 * (`- 09:05 Call` becomes `- [ ] 09:05 Call`), because a block links to a
 * task; that is the one line this touches besides the tick, and the block
 * leaves the capture time out. Refuses before writing anything when the line
 * changed, has no words, or `day` has no note (never created here).
 */
export async function planInboxLine(vault: Vault, workspaces: Workspace[], day: DayKey, line: number, expectedRaw: string): Promise<Triaged> {
	const found = await lineAt(vault, line, expectedRaw);
	if (!found.ok) return found;
	if (!(await vault.read(dailyNotePath(day))).exists) return { ok: false, reason: 'no-day' };

	let raw = expectedRaw;
	if (!parseTaskLine(raw)) {
		const [, indent, marker, , rest] = PLAIN_BULLET.exec(raw)!;
		raw = `${indent}${marker} [ ] ${rest}`;
		const lines = found.content.split('\n');
		lines[line] = raw;
		if (!(await vault.write(CAPTURE_PATH, lines.join('\n'), found.hash)).ok) return { ok: false, reason: 'line-changed' };
	}

	const planned = await addToDay(vault, workspaces, day, { path: CAPTURE_PATH, line, expectedRaw: raw });
	if (!planned.ok) return { ok: false, reason: planned.reason === 'no-day' ? 'no-day' : 'line-changed' };
	return tickLine(vault, line, raw, planned.path);
}

/**
 * Append the inbox line at `line` to the end of the workspace's
 * `<home>/Overview.md` as a bullet, `- <words>`, and tick the inbox line.
 * Answers the overview's path.
 *
 * The words are the line's, less the capture time and the workspace's own
 * tag, as a board card's would be. The note is only ever added to: one line
 * at its end, after a newline if it lacked one, and a missing note starts
 * as that one bullet. Refuses before writing anything when the line is not
 * the one the caller saw or has no words. Writes the note first and the
 * inbox second, so a failure between the two leaves the line unticked.
 */
export async function noteInboxLine(vault: Vault, workspace: Workspace, line: number, expectedRaw: string): Promise<Triaged> {
	const found = await lineAt(vault, line, expectedRaw);
	if (!found.ok) return found;

	const path = `${homeFolder(workspace)}/Overview.md`;
	const words = found.words.split(' ').filter((w) => w !== `#${workspace.tag}`).join(' ');
	const note = await vault.read(path);
	const content = note.exists ? note.content : '';
	const joined = content === '' || content.endsWith('\n') ? content : `${content}\n`;
	const written = await vault.write(path, `${joined}- ${words}\n`, note.exists ? note.hash : undefined);
	if (!written.ok) return { ok: false, reason: 'line-changed' };

	return tickLine(vault, line, expectedRaw, path);
}

/**
 * Add the inbox line at `line` to the subject's `Reading List.md` as an item
 * at the bottom of its first column, To read, and tick the inbox line.
 * Answers the reading list's path.
 *
 * The words are the line's, less the capture time and the subject's own
 * tags, read as the reading list reads any card: a `[title](url)` or a lone
 * URL is the item's link, and a trailing `#book` or other kind is its kind.
 * Refuses before writing anything when the line is not the one the caller
 * saw or has no words. A missing list is created with its four columns.
 * Writes the list first and the inbox second, so a failure between the two
 * leaves the line unticked.
 */
export async function studyInboxLine(vault: Vault, subject: Subject, line: number, expectedRaw: string): Promise<Triaged> {
	const found = await lineAt(vault, line, expectedRaw);
	if (!found.ok) return found;

	const own = new Set((subject.scope.tags ?? []).map((t) => `#${t}`));
	const words = found.words.split(' ').filter((w) => !own.has(w)).join(' ');
	if (!words) return { ok: false, reason: 'no-text' };
	const list = await readReadingList(vault, subject);
	const added = await changeReadingList(vault, subject, list.hash, { kind: 'add', group: 0, item: { title: words, url: null, kind: 'other', goal: null } });
	if (!added.ok) return { ok: false, reason: 'line-changed' };

	return tickLine(vault, line, expectedRaw, added.list.path);
}

/** Tick the inbox line at `line` and nothing else: "drop". Answers the inbox's path. */
export async function dropInboxLine(vault: Vault, line: number, expectedRaw: string): Promise<Triaged> {
	const found = await lineAt(vault, line, expectedRaw);
	return found.ok ? tickLine(vault, line, expectedRaw, CAPTURE_PATH) : found;
}

/** The inbox, if line `line` is still `expectedRaw` and has words to act on. */
async function lineAt(
	vault: Vault,
	line: number,
	expectedRaw: string
): Promise<{ ok: true; content: string; hash: string; words: string } | { ok: false; reason: 'no-note' | 'line-changed' | 'no-text' }> {
	const inbox = await vault.read(CAPTURE_PATH);
	if (!inbox.exists) return { ok: false, reason: 'no-note' };
	if (inbox.content.split('\n')[line] !== expectedRaw) return { ok: false, reason: 'line-changed' };
	const words = wordsOf(expectedRaw);
	return words ? { ok: true, content: inbox.content, hash: inbox.hash, words } : { ok: false, reason: 'no-text' };
}

/** Tick line `line` if it is still `raw`, and answer `path` for the caller. */
async function tickLine(vault: Vault, line: number, raw: string, path: string): Promise<Triaged> {
	const inbox = await vault.read(CAPTURE_PATH);
	const lines = inbox.content.split('\n');
	if (lines[line] !== raw) return { ok: false, reason: 'line-changed' };
	lines[line] = tick(raw);
	const written = await vault.write(CAPTURE_PATH, lines.join('\n'), inbox.hash);
	return written.ok ? { ok: true, path } : { ok: false, reason: 'line-changed' };
}

/**
 * The words an inbox line would carry as a card: everything after the bullet
 * (and its checkbox, when it has one), less the `HH:MM` stamp `capture.ts`
 * puts in front, which says when it was captured, not what it is. Null for a
 * bullet with no words at all.
 */
function wordsOf(raw: string): string | null {
	const m = BULLET.exec(raw);
	return m ? m[4].trim().replace(STAMP, '$2') || null : null;
}

/**
 * Mark the line done in place. A line already written as a task is ticked
 * through the one rewriter that knows the task grammar; a plain bullet gets a
 * checkbox added, already ticked, so it reads as filed without losing a word
 * of what was captured.
 */
function tick(raw: string): string {
	if (parseTaskLine(raw)) return rewriteTaskLine(raw, { status: 'done' });
	const m = PLAIN_BULLET.exec(raw);
	if (!m) return raw;
	const [, indent, marker, , rest] = m;
	return `${indent}${marker} [x] ${rest}`;
}

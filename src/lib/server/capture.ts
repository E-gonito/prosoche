/**
 * Quick capture, and where a captured line goes.
 *
 * Every capture box, the `c` and `k` keys and the phone's share sheet call
 * `capture`, which reads the line once and sends it to one of three places:
 *
 *  - the box on Today sits in the day's Unscheduled list, so what is typed
 *    there is a task for that day: it goes into the day's note under
 *    `# Tasks`, with a time if one was written and without one otherwise,
 *    ready to be dragged onto the timeline. Everywhere else the words decide:
 *
 *  - a line carrying a Day Planner range (`10:00 - 11:00 Dentist`) goes
 *    straight into today's note under `# Tasks`, as a task line;
 *  - a line naming a workspace by its tag (`#ws/kaya`) or an alias word
 *    goes onto that workspace's board, bottom of the first column, read the
 *    way the board's quick-add reads it (`Q1`, `#label`, a due word);
 *  - everything else lands in `Inbox/Capture.md` under a heading for the
 *    day, for the triage page and the Inbox card on Today to pick up.
 *
 * One inbox file rather than one file per thought, because an inbox of two
 * hundred one-line notes is worse than a list, and a single file is trivial
 * to read on a phone. A workspace's own capture box is the same inbox with
 * the workspace's tag appended, so its Inbox tab can filter the file.
 *
 * The routing rule is `routeCapture`, pure; `capture` carries it out and
 * never loses a line: a destination that cannot take it (no note for today,
 * a board that changed underneath) falls back to the inbox.
 */

import { today, type DayKey } from './daily';
import { appendUnderHeading } from './sections';
import { appendToDay, carries } from './day-plan';
import { changeBoard, readBoard } from './kanban';
import { parseQuickAdd } from './parse/kanban';
import { parseTaskLine, toTask } from './parse/task';
import { workspaceFor, type Workspace } from './workspaces';
import { formatMinutes } from '$lib/shared/time';
import type { Vault } from './vault/index';

export const CAPTURE_PATH = 'Inbox/Capture.md';

/** Where a captured line should go, decided from its words alone. */
export type CaptureRoute =
	/** A day's note, under `# Tasks`: `line` is the task line to append; the times are null for an unscheduled task. */
	| { to: 'day'; line: string; startMin: number | null; endMin: number | null }
	/** A board's first column: `text` is quick-add text, the workspace's tag taken out. */
	| { to: 'board'; workspace: Workspace; text: string }
	/** `Inbox/Capture.md`: `text` is what `appendUnderDay` is given. */
	| { to: 'inbox'; text: string };

/**
 * Decide where `text` goes. Pure.
 *
 * Read in this order, first match wins: `toDay`, the box on a day's own
 * Unscheduled list, sends it to the day whatever the words, timed or not; a
 * time range (the task grammar's `HH:MM - HH:MM` at the start of the words)
 * sends it to the day; a
 * `workspace` given by the caller, a workspace's own capture box, sends it
 * to the inbox with that workspace's tag appended when the words do not
 * already carry it; a tag or alias naming a workspace, read by the board's
 * quick-add grammar and `workspaceFor`, sends it to that board; anything else
 * to the inbox as typed. `text` may be bare words or a whole task line such
 * as `- [ ] Buy milk \`Q2\``; a task line keeps its own checkbox. Never
 * returns an empty `text`, because `capture` refuses blank input first.
 */
export function routeCapture(
	text: string,
	workspaces: Workspace[],
	options: { workspace?: Workspace; day: DayKey; toDay?: boolean }
): CaptureRoute {
	const trimmed = text.trim();
	const asTask = parseTaskLine(trimmed);
	const task = asTask ?? parseTaskLine(`- [ ] ${trimmed}`);
	const own = options.workspace;
	const tagged = (line: string) => (own && !carries(line, own.tag) ? `${line} #${own.tag}` : line);
	const line = tagged(asTask ? trimmed : `- [ ] ${trimmed}`);

	const timed = task ? toTask(task, '') : null;
	if (options.toDay) return { to: 'day', line, startMin: timed?.startMin ?? null, endMin: timed?.endMin ?? null };
	if (timed && timed.startMin !== null && timed.endMin !== null) {
		const { startMin, endMin } = timed;
		return { to: 'day', line, startMin, endMin };
	}
	if (own) return { to: 'inbox', text: tagged(trimmed) };

	// A task line's words, without its bullet and checkbox, are what quick-add reads.
	const words = asTask ? trimmed.slice(asTask.spans.bodyStart).trim() : trimmed;
	const quick = parseQuickAdd(words, options.day);
	// No path, so a workspace whose folder happens to be `Inbox` claims nothing.
	const owner = workspaceFor(workspaces, { path: '', tags: quick.labels, text: words });
	if (owner) {
		const card = words
			.split(' ')
			.filter((word) => word !== `#${owner.tag}`)
			.join(' ')
			.trim();
		if (card) return { to: 'board', workspace: owner, text: card };
	}
	return { to: 'inbox', text: trimmed };
}

/** Where a capture went: the file written, and the sentence to show for it. */
export interface Captured {
	path: string;
	to: CaptureRoute['to'];
	message: string;
}

/**
 * Capture one line, wherever `routeCapture` sends it, and say where it went.
 *
 * Inputs: the vault, every workspace, the text, `workspace` for a
 * workspace's own capture box, and `day` for the box on a day's Unscheduled
 * list, which sends the line to that day's note. Output: the file written
 * and a sentence for the person who typed it. Side effects: exactly one
 * append, to a day's note, one board's `Board.md` or `Inbox/Capture.md`.
 * Never creates a day's note (a line bound for a day with no note falls
 * back to the inbox) and never
 * creates a board a workspace does not have yet (a line naming one is kept
 * in the inbox, where the workspace's tab still finds it). Blank text writes
 * nothing and answers the inbox's path.
 */
export async function capture(
	vault: Vault,
	workspaces: Workspace[],
	text: string,
	options: { workspace?: Workspace; now?: Date; day?: DayKey } = {}
): Promise<Captured> {
	const now = options.now ?? new Date();
	const day = options.day ?? today(now);
	const trimmed = text.trim();
	if (!trimmed) return { path: CAPTURE_PATH, to: 'inbox', message: '' };

	const route = routeCapture(trimmed, workspaces, { workspace: options.workspace, day, toDay: options.day !== undefined });
	if (route.to === 'day') {
		const planned = await appendToDay(vault, day, route.line);
		if (planned.ok) {
			const which = day === today(now) ? 'today' : day;
			const when = route.startMin !== null && route.endMin !== null ? `, ${formatMinutes(route.startMin)}–${formatMinutes(route.endMin)}` : "'s unscheduled list";
			return { path: planned.path, to: 'day', message: `Added to ${which}${when}` };
		}
		return toInbox(vault, route.line, now, `${day === today(now) ? 'Today' : 'That day'} has no note yet, so it went to Inbox/Capture.md`);
	}
	if (route.to === 'board') {
		const board = await readBoard(vault, route.workspace);
		if (board.exists && board.columns.length > 0) {
			const added = await changeBoard(vault, route.workspace, board.hash, { kind: 'add-card', column: 0, text: route.text });
			if (added.ok) return { path: board.path, to: 'board', message: `Added to ${route.workspace.name}'s board` };
		}
	}
	return toInbox(vault, route.to === 'inbox' ? route.text : trimmed, now);
}

async function toInbox(vault: Vault, text: string, now: Date, message = `Saved to ${CAPTURE_PATH}`): Promise<Captured> {
	// Retried once against a clash: an append loses nothing by being redone.
	for (let attempt = 0; attempt < 3; attempt++) {
		const note = await vault.read(CAPTURE_PATH);
		const updated = appendUnderDay(note.exists ? note.content : '# Capture\n', text, today(now), clock(now));
		const written = await vault.write(CAPTURE_PATH, updated, attempt < 2 && note.exists ? note.hash : undefined);
		if (written.ok) break;
	}
	return { path: CAPTURE_PATH, to: 'inbox', message };
}

/**
 * Insert `text` under a `## <day>` heading, creating the heading when the day
 * is new. Exported for testing; the string handling is the part worth proving.
 *
 * A bare line is stamped with the time; a line that is already a task is kept
 * as written, so pasting a task into capture does not produce a task inside a
 * bullet.
 */
export function appendUnderDay(content: string, text: string, day: DayKey, time: string): string {
	const entry = parseTaskLine(text) ? text : `- ${time} ${text}`;
	return appendUnderHeading(content, `## ${day}`, entry).content;
}

function clock(now: Date): string {
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

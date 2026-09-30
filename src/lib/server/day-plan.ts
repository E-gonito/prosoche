/**
 * Putting a card from somewhere else in the vault onto a day.
 *
 * A card is a task line in a project note. Planning it for Tuesday has to be
 * written somewhere, and there were two honest places to write it.
 *
 * The alternative considered was to keep the card where it is and give it a
 * scheduled date — `⏳ 2026-09-22` — so the day's view could gather every card
 * pointed at that day from across the vault. It is one line of writing rather
 * than two, and nothing is duplicated.
 *
 * This module does the other thing: it appends a block to the day's own note
 * that links back to the card. The day's note stays the record of the day,
 * which is the premise the whole app is built on; Day Planner in Obsidian
 * shows the block without knowing anything about this app; and time spent is
 * attributed to the block, where the hours actually are. The cost is two
 * checkboxes for one piece of work, which is the truth rather than a
 * duplication: the block is *time on* the card, the card is the card.
 *
 * Writing is append-only, as everywhere else that touches a note the user
 * keeps by hand. The card's own line is read to confirm it is still the line
 * the caller saw, and is never rewritten.
 */

import { appendUnderHeading } from './sections';
import { config } from './config';
import { dailyNotePath, type DayKey } from './daily';
import { parseTaskLine, toTask } from './parse/task';
import { scanTags } from './parse/note';
import { workspaceFor, type Workspace } from './workspaces';
import { formatMinutes } from '../shared/time';
import type { Task } from '../shared/task';
import type { Vault } from './vault/index';

/** The card being planned, as the caller last saw it. */
interface TaskRef {
	path: string;
	/** 0-based line of the card in its note. */
	line: number;
	/** That line's text, for per-line conflict detection. */
	expectedRaw: string;
}

type DayPlanned =
	| {
			ok: true;
			/** The day's note the block was written to. */
			path: string;
			/** 0-based line the block landed on. */
			line: number;
			/** The block exactly as written. */
			raw: string;
			/** That line parsed back, so a caller can render it without re-reading. */
			task: Task;
	  }
	| { ok: false; reason: 'no-note' }
	/** The day has no note. Only `createDayNote`, on a click, makes one, so nothing is written. */
	| { ok: false; reason: 'no-day' }
	| { ok: false; reason: 'not-a-task' }
	| { ok: false; reason: 'line-changed'; current: string | null };

/**
 * Append a block to `day`'s note for the card at `task`, and return it.
 *
 * The block reads `- [ ] 10:00 - 10:30 <the card's words> [[Study/Algorithms]]
 * `Q2` #ws/study`: the time range only when `time` is given, the quadrant only
 * when the card carries one, and the workspace tag only when a workspace
 * claims the card and its words do not already say so. The wikilink is always
 * there — without it the block is a copy rather than a reference.
 *
 * Inserts under `config.dailyNote.tasksHeading`, which puts the block at the
 * end of the plan and above whatever heading follows it. Never creates the
 * day's note: that is `createDayNote`'s, on an explicit click, because a
 * server-made copy of a file Obsidian also makes is what makes two devices'
 * git histories collide.
 *
 * Refuses rather than writes when the card's note is gone, when its line is no
 * longer the line the caller saw, or when that line is not a task. It never
 * edits the card's line, never writes anywhere but the day's note, and never
 * reorders or reformats anything already in it.
 */
export async function addToDay(
	vault: Vault,
	workspaces: Workspace[],
	day: DayKey,
	task: TaskRef,
	time?: { startMin: number; endMin: number }
): Promise<DayPlanned> {
	const source = await vault.read(task.path);
	if (!source.exists) return { ok: false, reason: 'no-note' };

	const current = source.content.split('\n')[task.line] ?? null;
	if (current !== task.expectedRaw) return { ok: false, reason: 'line-changed', current };

	const card = parseTaskLine(current, task.line);
	if (!card) return { ok: false, reason: 'not-a-task' };

	const raw = blockLine(card.text, card.quadrant, task.path, workspaceFor(workspaces, { path: task.path, tags: card.tags }), time);
	return appendToDay(vault, day, raw);
}

/**
 * Append `raw`, one task line, under `# Tasks` in `day`'s note, and return
 * where it landed, parsed back. The one writer of a new line into a day's
 * plan: `addToDay` composes a linked block for it, `capture.ts` hands it a
 * captured line that already carries a time.
 *
 * Refuses with `no-day` when the note is absent and never creates it. `raw`
 * must parse as a task line; a caller passing anything else gets `not-a-task`
 * and nothing is written. Never edits or reorders a line already there.
 */
export async function appendToDay(vault: Vault, day: DayKey, raw: string): Promise<DayPlanned> {
	if (!parseTaskLine(raw)) return { ok: false, reason: 'not-a-task' };
	const path = dailyNotePath(day);
	if (!(await vault.read(path)).exists) return { ok: false, reason: 'no-day' };

	// Guarded by the note's hash, then tried once more against what is there
	// now. A third clash writes unguarded: the append is additive, so the worst
	// case is losing a keystroke typed in the same instant, while dropping the
	// write would lose the plan the user just made. Same trade as `appendEntry`.
	for (let attempt = 0; attempt < 3; attempt++) {
		const note = await vault.read(path);
		const next = appendUnderHeading(note.content, config.dailyNote.tasksHeading, raw);
		const result = await vault.write(path, next.content, attempt < 2 ? note.hash : undefined);
		if (result.ok) {
			return { ok: true, path, line: next.line, raw, task: toTask(parseTaskLine(raw, next.line)!, path) };
		}
	}
	return { ok: false, reason: 'line-changed', current: null };
}

type DayCreated =
	| { ok: true; path: string; fromTemplate: boolean }
	| { ok: false; reason: 'exists'; path: string };

/**
 * Create `day`'s note from `config.dailyNote.template`, the one way prosoche
 * ever makes a daily note, and only when a person pressed "Create today's
 * note".
 *
 * The template is copied byte for byte, through `fillTemplate`, which only
 * touches Obsidian's `{{date}}` and `{{title}}` placeholders when there are
 * any. A missing template gives a note holding only the tasks heading, and
 * `fromTemplate: false` says so. Refuses with `exists` when the note is
 * already there, whatever it holds: nothing is ever overwritten. Writes one
 * file and nothing else.
 */
export async function createDayNote(vault: Vault, day: DayKey): Promise<DayCreated> {
	const path = dailyNotePath(day);
	if ((await vault.read(path)).exists) return { ok: false, reason: 'exists', path };
	const template = await vault.read(config.dailyNote.template);
	const content = template.exists ? fillTemplate(template.content, day) : `${config.dailyNote.tasksHeading}
`;
	await vault.write(path, content);
	return { ok: true, path, fromTemplate: template.exists };
}

/**
 * The template's text for `day`: every `{{date}}` and `{{title}}` (any case,
 * spaces allowed inside the braces) becomes the day's `YYYY-MM-DD`. Any other
 * placeholder, such as `{{time}}` or `{{date:dddd}}`, is kept verbatim, since
 * guessing at Moment formats would write something Obsidian would not; a
 * template with no placeholders comes back unchanged, byte for byte. `title`
 * is the day too, not Obsidian's file name (`30`), because the day is what a
 * title placeholder in a journal template means. Pure.
 */
export function fillTemplate(template: string, day: DayKey): string {
	return template.replace(/\{\{\s*(date|title)\s*\}\}/gi, day);
}

/**
 * Compose the block. The card's words are copied exactly as they are written,
 * markdown and all, so the day's note says what the card says rather than a
 * normalised paraphrase of it.
 */
function blockLine(
	text: string,
	quadrant: number | null,
	path: string,
	workspace: Workspace | null,
	time?: { startMin: number; endMin: number }
): string {
	const parts = ['- [ ]'];
	if (time) parts.push(`${formatMinutes(time.startMin)} - ${formatMinutes(time.endMin)}`);
	// A leading lone `HH:MM` is when a capture arrived, not when to do it, and
	// Day Planner would read it as the block's start; the day's note gets the
	// words without it. A card can be nothing but a link and a tag; skipping
	// its empty words keeps the block from carrying a stray double space.
	const words = text.replace(/^\d{1,2}:\d{2}[ \t]+/, '');
	if (words) parts.push(words);
	parts.push(`[[${path.replace(/\.md$/, '')}]]`);
	if (quadrant) parts.push(`\`Q${quadrant}\``);
	if (workspace && !carries(text, workspace.tag)) parts.push(`#${workspace.tag}`);
	return parts.join(' ');
}

/** Whether the card's own words already carry `tag`, or a tag nested under it. */
function carries(text: string, tag: string): boolean {
	return scanTags(text).some((t) => t.tag === tag || t.tag.startsWith(`${tag}/`));
}

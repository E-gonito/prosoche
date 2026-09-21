/**
 * The `inbox` widget: captures that have not been filed anywhere yet.
 *
 * Two kinds of thing, because capture produces two. Anything dropped into
 * `Inbox/` as its own note is listed as a note. Quick capture, though, writes
 * a bullet per thought into one file, so those are listed as lines — each with
 * the line number and the bytes it currently holds, which is what a filing
 * proposal needs to refuse a stale page.
 *
 * A line already ticked or struck through is not shown, which is how a task
 * that has been filed leaves this list: filing marks it cancelled rather than
 * deleting it, so the record stays in the note. A plain bullet has no marker
 * to set, so it stays listed until the user deals with it themselves — the
 * filing proposal says as much before it is accepted.
 */

import { CAPTURE_PATH } from '../capture';
import { parseTaskLine } from '../parse/task';
import { recentNotes } from './notes';
import type { NoteSummary } from './notes';
import type { WidgetContext } from '../widgets';

/** One captured thought, as a line of the capture note. */
export interface CaptureLine {
	line: number;
	/** The whole line, for the conflict check when it is filed. */
	raw: string;
	/** Just the thought, without the bullet and the arrival time. */
	text: string;
	/** The `## YYYY-MM-DD` heading it sits under, or '' above the first one. */
	day: string;
}

export interface InboxWidget {
	notes: NoteSummary[];
	lines: CaptureLine[];
	folder: string;
	capturePath: string;
	total: number;
}

/** Where quick capture writes, and where anything unsorted is expected to be. */
const INBOX = 'Inbox';
const SHOW = 8;

export async function load(ctx: WidgetContext): Promise<InboxWidget> {
	const found = await recentNotes(ctx.vault, ctx.index, { under: [INBOX], limit: SHOW });
	const capture = await ctx.vault.read(CAPTURE_PATH);
	return {
		notes: found.notes.filter((n) => n.path !== CAPTURE_PATH),
		lines: capture.exists ? captureLines(capture.content).slice(0, SHOW) : [],
		folder: INBOX,
		capturePath: CAPTURE_PATH,
		total: found.total
	};
}

/**
 * The unfiled lines of a capture note, newest first.
 *
 * Exported for testing, because the interesting part is what it leaves out: a
 * line that is a completed or cancelled task, a heading, and anything blank.
 * A line that is not a bullet at all is still returned — someone typing a
 * paragraph into their inbox meant to keep it.
 */
export function captureLines(content: string): CaptureLine[] {
	const out: CaptureLine[] = [];
	let day = '';
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(raw);
		if (heading) {
			day = heading[1];
			continue;
		}
		if (raw.trim() === '' || raw.startsWith('#')) continue;

		const task = parseTaskLine(raw);
		if (task && (task.status === 'done' || task.status === 'cancelled')) continue;

		const text = raw.replace(/^[-*+]\s+(\[.\]\s+)?(\d{2}:\d{2}\s+)?/, '').trim();
		if (text === '') continue;
		out.push({ line: i, raw, text, day });
	}
	return out.reverse();
}

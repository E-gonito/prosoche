/**
 * Quick capture.
 *
 * Anything typed into the capture box lands in one markdown file in the
 * vault's Inbox, under a heading for the day. One file rather than one file
 * per thought, because an inbox of two hundred one-line notes is worse than a
 * list, and because a single file is trivial to read on a phone.
 *
 * A line that already looks like a task is kept as a task. Anything else
 * becomes a bullet with the time it arrived.
 */

import { today, type DayKey } from './daily';
import { appendUnderHeading } from './sections';
import { parseTaskLine } from './parse/task';
import type { Vault } from './vault/index';

export const CAPTURE_PATH = 'Inbox/Capture.md';

/** Append one captured line. Returns the path it went to. */
export async function capture(vault: Vault, text: string, now = new Date()): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) return CAPTURE_PATH;

	const note = await vault.read(CAPTURE_PATH);
	const updated = appendUnderDay(note.exists ? note.content : '# Capture\n', trimmed, today(now), clock(now));
	await vault.write(CAPTURE_PATH, updated, note.exists ? note.hash : undefined);
	return CAPTURE_PATH;
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

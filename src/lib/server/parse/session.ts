/**
 * Parsing and writing the study section's session log lines.
 *
 * `Sessions.md` holds one line per study session, filed under a `## YYYY-MM`
 * heading:
 *
 *     - 2026-09-29 45m [[Algorithms]] graph search, finally clicked
 *
 * a day, how long, an optional topic wikilink, and a free note. The duration
 * is the time log's own grammar — `$lib/shared/duration` — so `1h30m`, `90m`
 * and `1h` all read back the same number of minutes whichever way they were
 * written, and this module never invents a second duration syntax.
 *
 * Pure, like every other line grammar in `parse/`: no filesystem, no clock.
 * `study/sessions.ts` is the only caller, and the only place that reads or
 * writes `Sessions.md`.
 */

import { formatDuration, parseDuration } from '$lib/shared/duration';

export interface Session {
	/** 0-based line this session was read from. Absent for one not yet written. */
	line: number;
	/** `YYYY-MM-DD`. */
	day: string;
	minutes: number;
	/** The name inside `[[ ]]`, or null when the line names no topic. */
	topic: string | null;
	/** Free text after the topic, or after the duration when there is no topic. */
	note: string;
	raw: string;
}

/** What a new session needs; `line` and `raw` are only known once it is written. */
export type SessionEntry = Pick<Session, 'day' | 'minutes' | 'topic' | 'note'>;

const LINE = /^-[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(\S+)(?:[ \t]+\[\[([^[\]]+)\]\])?(?:[ \t]+(.*?))?[ \t]*$/;

/**
 * Parse one line, or null when it is not a session: not this exact shape, or
 * a duration token `$lib/shared/duration`'s own parser does not recognise.
 */
export function parseSessionLine(raw: string, line = 0): Session | null {
	const m = LINE.exec(raw);
	if (!m) return null;
	const minutes = parseDuration(m[2]);
	if (minutes === null) return null;
	return { line, day: m[1], minutes, topic: m[3] ?? null, note: m[4] ?? '', raw };
}

/** Every session line in a note, in file order. Pure. */
export function parseSessions(content: string): Session[] {
	const out: Session[] = [];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const session = parseSessionLine(lines[i], i);
		if (session) out.push(session);
	}
	return out;
}

/**
 * One session as a line, in the exact format this module reads. The inverse
 * of `parseSessionLine`, minus `line`, which only exists once the line has a
 * position in a file.
 */
export function formatSessionLine(entry: SessionEntry): string {
	const parts = [`- ${entry.day}`, formatDuration(entry.minutes)];
	if (entry.topic) parts.push(`[[${entry.topic}]]`);
	if (entry.note) parts.push(entry.note);
	return parts.join(' ');
}

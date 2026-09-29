/**
 * The session log: how long the user studied, when, on what — and the
 * figures Overview and the Sessions page are built from.
 *
 * The line grammar itself lives in `parse/session.ts`; this module is the
 * only thing that reads or writes `Sessions.md`, and the only thing that
 * turns a list of sessions into a streak, a week's total or a topic
 * breakdown. Everything below is a pure function of the sessions it is
 * given, so the arithmetic is table-tested without touching a vault.
 */

import { shiftDay } from '../daily';
import { appendUnderHeading } from '../sections';
import { formatSessionLine, parseSessions, type Session, type SessionEntry } from '../parse/session';
import type { Vault } from '../vault/index';

export type { Session, SessionEntry };

/** Monday of the week containing `day`, as `YYYY-MM-DD`. */
export function weekStart(day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const at = new Date(Date.UTC(y, m - 1, d));
	// `getUTCDay` is 0 for Sunday; this turns it into days since Monday.
	const sinceMonday = (at.getUTCDay() + 6) % 7;
	at.setUTCDate(at.getUTCDate() - sinceMonday);
	return at.toISOString().slice(0, 10);
}

/** Total minutes across the seven days starting `start` (inclusive). */
export function minutesInWeek(sessions: Session[], start: string): number {
	const end = shiftDay(start, 7);
	return sessions.filter((s) => s.day >= start && s.day < end).reduce((sum, s) => sum + s.minutes, 0);
}

/** Minutes logged in the calendar week `today` falls in. */
export function minutesThisWeek(sessions: Session[], today: string): number {
	return minutesInWeek(sessions, weekStart(today));
}

/**
 * Consecutive days with at least one session, counting back from today.
 *
 * Today is never counted as a miss: a day not yet studied is a day not yet
 * over, so the streak simply starts counting from yesterday instead of
 * breaking.
 */
export function streak(sessions: Session[], today: string): number {
	const days = new Set(sessions.map((s) => s.day));
	let count = 0;
	let day = today;
	if (days.has(day)) {
		count++;
		day = shiftDay(day, -1);
	} else {
		day = shiftDay(day, -1);
	}
	while (days.has(day)) {
		count++;
		day = shiftDay(day, -1);
	}
	return count;
}

export interface TopicMinutes {
	/** The topic wikilink's text, or "Untracked" for a session that names none. */
	topic: string;
	minutes: number;
}

/** Minutes per topic for the calendar month `on` falls in, most first. */
export function minutesByTopic(sessions: Session[], on: string): TopicMinutes[] {
	const month = on.slice(0, 7);
	const totals = new Map<string, number>();
	for (const s of sessions) {
		if (s.day.slice(0, 7) !== month) continue;
		const topic = s.topic ?? 'Untracked';
		totals.set(topic, (totals.get(topic) ?? 0) + s.minutes);
	}
	return [...totals.entries()].map(([topic, minutes]) => ({ topic, minutes })).sort((a, b) => b.minutes - a.minutes);
}

export interface WeekMinutes {
	/** Monday of the week, `YYYY-MM-DD`. */
	start: string;
	minutes: number;
}

/** One bucket per week, oldest first, ending with the week `today` is in. */
export function weeklyMinutes(sessions: Session[], today: string, weeks = 8): WeekMinutes[] {
	const starts: string[] = [];
	let start = weekStart(today);
	for (let i = 0; i < weeks; i++) {
		starts.unshift(start);
		start = shiftDay(start, -7);
	}
	return starts.map((s) => ({ start: s, minutes: minutesInWeek(sessions, s) }));
}

export type SessionWrite = { ok: true; entry: Session } | { ok: false; reason: 'conflict' };

/**
 * Append one session under its month's `## YYYY-MM` heading, creating both
 * the note and the heading when they are new. Never rewrites an existing
 * line: this is the one write `Sessions.md` ever gets.
 */
export async function logSession(vault: Vault, path: string, entry: SessionEntry): Promise<SessionWrite> {
	const note = await vault.read(path);
	const heading = `## ${entry.day.slice(0, 7)}`;
	const raw = formatSessionLine(entry);
	const { content, line } = appendUnderHeading(note.content, heading, raw);
	const written = await vault.write(path, content, note.exists ? note.hash : undefined);
	if (!written.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, entry: { ...entry, line, raw } };
}

/** Read and parse `Sessions.md`. A missing note is simply no sessions. */
export async function readSessions(vault: Vault, path: string): Promise<Session[]> {
	return parseSessions((await vault.read(path)).content);
}

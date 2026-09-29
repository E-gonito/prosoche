/**
 * The session log: how long the user studied, when, on what — and the
 * figures Overview and the Sessions page are built from.
 *
 * The line grammar itself lives in `parse/session.ts`; this module is the
 * only thing that reads or writes `Sessions.md`, and the only thing that
 * turns a list of sessions into a streak, a week's total or a breakdown by
 * goal. A session points at a goal through its link, `[[Goals#<goal>]]`;
 * the link grammar is `goals.ts`'s. Everything but the two file functions is
 * a pure function of the sessions it is given, so the arithmetic is
 * table-tested without touching a vault.
 */

import { shiftDay } from '../daily';
import { appendUnderHeading } from '../sections';
import { formatSessionLine, parseSessions, type Session, type SessionEntry } from '../parse/session';
import { goalOf, goalTarget } from './goals';
import type { Vault } from '../vault/index';

export type { Session, SessionEntry };

/**
 * A session as Study reads it: the line, and the goal its link points at, or
 * null for a session with no link or an old `[[Topic]]` one, which is kept
 * in `topic` and shown as written.
 */
export interface StudySession extends Session {
	goal: string | null;
}

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

export interface GoalMinutes {
	/**
	 * The goal's name; for a session from before goals, its `[[Topic]]` link
	 * as written; "Untracked" for a session that names neither.
	 */
	label: string;
	/** True when `label` is a goal rather than an old topic or "Untracked". */
	goal: boolean;
	minutes: number;
}

/**
 * Minutes per goal across the days `from` (inclusive) to `to` (exclusive),
 * most first. Sessions logged against an old topic keep their own line, as
 * written, rather than being folded into a goal they never named.
 */
export function minutesByGoal(sessions: StudySession[], from: string, to: string): GoalMinutes[] {
	const totals = new Map<string, GoalMinutes>();
	for (const s of sessions) {
		if (s.day < from || s.day >= to) continue;
		const label = s.goal ?? s.topic ?? 'Untracked';
		const key = `${s.goal !== null}:${label}`;
		const entry = totals.get(key) ?? { label, goal: s.goal !== null, minutes: 0 };
		entry.minutes += s.minutes;
		totals.set(key, entry);
	}
	return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
}

/** The first day of `day`'s month and of the month after, for `minutesByGoal`. */
export function monthRange(day: string): { from: string; to: string } {
	const [y, m] = day.split('-').map(Number);
	const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
	return { from: `${day.slice(0, 7)}-01`, to: `${next}-01` };
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

export type SessionWrite = { ok: true; entry: StudySession } | { ok: false; reason: 'conflict' };

/**
 * Append one session under its month's `## YYYY-MM` heading, creating both
 * the note and the heading when they are new. A session for a goal links to
 * it, `[[Goals#<goal>]]`; one for no goal links nothing. Never rewrites an
 * existing line: this is the one write `Sessions.md` ever gets.
 */
export async function logSession(
	vault: Vault,
	path: string,
	entry: { day: string; minutes: number; goal: string | null; note: string }
): Promise<SessionWrite> {
	const note = await vault.read(path);
	const heading = `## ${entry.day.slice(0, 7)}`;
	const written: SessionEntry = { day: entry.day, minutes: entry.minutes, topic: entry.goal ? goalTarget(entry.goal) : null, note: entry.note };
	const raw = formatSessionLine(written);
	const { content, line } = appendUnderHeading(note.content, heading, raw);
	const result = await vault.write(path, content, note.exists ? note.hash : undefined);
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, entry: { ...written, line, raw, goal: entry.goal } };
}

/**
 * Read and parse `Sessions.md`, each session with the goal its link points
 * at. A missing note is simply no sessions.
 */
export async function readSessions(vault: Vault, path: string): Promise<StudySession[]> {
	return parseSessions((await vault.read(path)).content).map((s) => ({ ...s, goal: goalOf(s.topic) }));
}

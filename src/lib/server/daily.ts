/**
 * Where a day's note lives, and how days are named in the UI.
 *
 * The vault's daily notes are `Journal/YYYY/MM/DD.md`, created from
 * `Journal/Journal Template.md`. Dates are handled as plain `YYYY-MM-DD`
 * strings rather than Date objects, because a calendar day here is a local
 * label, not an instant, and timezone arithmetic on it only creates bugs.
 */

import { config } from './config';

export type DayKey = string; // YYYY-MM-DD

export function today(now = new Date()): DayKey {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Vault-relative path of a day's note. */
export function dailyNotePath(day: DayKey): string {
	const [y, m, d] = day.split('-');
	return `${config.dailyNote.folder}/${y}/${m}/${d}.md`;
}

/**
 * A SQLite GLOB that matches only the daily notes, and nothing else under the
 * journal folder.
 *
 * It exists because a workspace's notes can live inside the journal folder
 * too, at `Journal/Projects/...`. Excluding the whole folder to skip the
 * daily template copies would silently empty that workspace's board.
 */
export const DAILY_NOTE_GLOB = `${config.dailyNote.folder}/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9].md`;

/** True for a path that is one of the dated daily notes. */
export function isDailyNote(path: string): boolean {
	return dayOfNote(path) !== null;
}

/**
 * The day a note is about, or null when the path is not a daily note. The
 * inverse of `dailyNotePath`, so anything that reads a date out of a path uses
 * the same rule that wrote it.
 */
export function dayOfNote(path: string): DayKey | null {
	const m = new RegExp(`^${config.dailyNote.folder}/(\\d{4})/(\\d{2})/(\\d{2})\\.md$`).exec(path);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** The day before or after, as a DayKey. `offset` may be negative. */
export function shiftDay(day: DayKey, offset: number): DayKey {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d + offset);
	return today(date);
}

/** "Monday 21 September 2026", for page headings. */
export function formatDay(day: DayKey): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

/** True for a well-formed YYYY-MM-DD that names a real calendar day. */
export function isDayKey(value: string): value is DayKey {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Minutes since midnight rendered as HH:MM. */
export function formatMinutes(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

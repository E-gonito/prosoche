/**
 * Clock and duration arithmetic, and the shape of a running timer.
 *
 * Shared between the server and the browser, so it must not import anything
 * server-only. Times are minutes since midnight once parsed, matching the rest
 * of the codebase; durations are whole minutes, because that is the resolution
 * the vault's time log writes and reading a log is not helped by seconds.
 *
 * `RunningTimer` lives here rather than in `$server/timelog` because the header
 * component, the API route and the timer module all need it, and a component
 * may never import a server module.
 */

/** Minutes in a calendar day, the modulus for anything that crosses midnight. */
export const MINUTES_IN_DAY = 1440;

/**
 * Minutes since midnight for an `HH:MM` reading, or null when the text is not
 * a time of day. `9:30` and `09:30` are both accepted, because the vault
 * contains both; `24:00` and `10:75` are not, because they are not times.
 */
export function parseClock(text: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!m) return null;
	const hours = Number(m[1]);
	const minutes = Number(m[2]);
	if (hours > 23 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/**
 * Minutes from one clock reading to another, treating an end before the start
 * as crossing midnight.
 *
 * The one place this arithmetic lives. `taskMinutes` in `shared/task.ts` and
 * `blockMinutes` in `server/schedule.ts` compute the same thing over their own
 * shapes and should be reduced to calls to this.
 */
export function spanMinutes(startMin: number, endMin: number): number {
	const span = endMin - startMin;
	return span < 0 ? span + MINUTES_IN_DAY : span;
}

/**
 * A duration as the time log writes it: `1h23m`, `2h`, `45m`, `0m`. Never
 * negative, so a nonsensical input reads as no time rather than as a minus
 * sign in the middle of a note.
 *
 * `gap` is what separates the hours from the minutes, and is empty by default
 * so that what goes into a note stays compact and `parseDuration` round-trips
 * it. A screen passes `' '`, because `7h 20m` is how a figure being read is
 * written. One function rather than two, so there is one answer to "how long
 * was it" and only the spacing is the caller's choice.
 */
export function formatDuration(minutes: number, gap = ''): string {
	const total = Math.max(0, Math.round(minutes));
	const hours = Math.floor(total / 60);
	const rest = total % 60;
	if (!hours) return `${rest}m`;
	return rest ? `${hours}h${gap}${rest}m` : `${hours}h`;
}

/**
 * Minutes from a written duration, or null when the text is not one.
 *
 * The inverse of `formatDuration`, tolerant of the space a human leaves in
 * `1h 23m`. Used only to recognise and skip the duration on a log line: the
 * clock range on that line is what the minutes are computed from.
 */
export function parseDuration(text: string): number | null {
	const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
	const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(cleaned);
	if (!m || (!m[1] && !m[2])) return null;
	return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/**
 * A ticking timer's elapsed time: `7:04` below an hour, `1:23:45` above it.
 *
 * Seconds appear here and nowhere else. A running timer is the one place they
 * matter, because a display that only changed once a minute looks broken.
 */
export function formatElapsed(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const s = String(total % 60).padStart(2, '0');
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A timer that has started and not yet stopped. */
export interface RunningTimer {
	/** Vault-relative path of the note holding the task being timed. */
	path: string;
	/** 0-based line of that task, as the vault numbers lines. */
	line: number;
	/** What to call it in the header, taken from the task when it parsed as one. */
	text: string;
	/** Workspace tag without `#`, resolved at start, or null when unassigned. */
	workspace: string | null;
	quadrant: number | null;
	/** When it started, as an ISO 8601 instant. */
	startedAt: string;
	/** The day whose `## Time log` will receive the entry, as `YYYY-MM-DD`. */
	day: string;
}

/** What the timer endpoint answers with, whichever way it was asked. */
export interface TimerState {
	timer: RunningTimer | null;
	/** The server's clock, so a browser can correct for its own skew. */
	now: string;
	/**
	 * The entry just written, when this response followed a stop. Null after a
	 * plain read, so the header can show "23m logged" only when it happened.
	 */
	logged: { day: string; minutes: number; text: string } | null;
}

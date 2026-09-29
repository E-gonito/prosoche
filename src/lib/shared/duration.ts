/**
 * Duration arithmetic: minutes to and from the words a study session or a
 * flashcard deck writes them as.
 *
 * Shared between the server and the browser, so it must not import anything
 * server-only. Durations are whole minutes, because that is the resolution
 * every note that carries one writes, and reading one back is not helped by
 * seconds.
 */

/**
 * A duration the way a session or a card writes it: `1h23m`, `2h`, `45m`,
 * `0m`. Never negative, so a nonsensical input reads as no time rather than
 * as a minus sign in the middle of a note.
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
 * `1h 23m`. `study/sessions.ts` uses it to read `Sessions.md`'s own duration
 * column back into minutes.
 */
export function parseDuration(text: string): number | null {
	const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
	const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(cleaned);
	if (!m || (!m[1] && !m[2])) return null;
	return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

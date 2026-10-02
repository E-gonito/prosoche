/**
 * Duration arithmetic: minutes as the words a screen writes them as.
 *
 * Shared between the server and the browser, so it must not import anything
 * server-only. Durations are whole minutes; seconds would not help anyone
 * reading one.
 */

/**
 * A duration written compactly: `1h23m`, `2h`, `45m`, `0m`. Never
 * negative, so a nonsensical input reads as no time rather than as a minus
 * sign.
 *
 * `gap` is what separates the hours from the minutes, empty by default. A
 * screen passes `' '`, because `7h 20m` is how a figure being read is
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

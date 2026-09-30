/** Shared between server and browser, so it must not import anything server-only. */
export function formatMinutes(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `day` plus `days`, as `YYYY-MM-DD`. Negative counts move backwards. Pure. */
export function addDays(day: string, days: number): string {
	return new Date(utc(day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to`; negative when `to` is the earlier day. Pure. */
export function daysBetween(from: string, to: string): number {
	return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * Midnight UTC for a `YYYY-MM-DD` label. Going through UTC rather than the
 * local Date parser is what keeps day arithmetic from drifting by one across a
 * daylight-saving boundary.
 */
function utc(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, (m || 1) - 1, d || 1);
}

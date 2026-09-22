/** Shared between server and browser, so it must not import anything server-only. */
export function formatMinutes(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * How long ago a calendar day was, in the words a list uses: "today",
 * "yesterday", "5 days ago", "3 weeks ago", and the date itself once that
 * stops meaning anything. Both arguments are `YYYY-MM-DD` labels, so this
 * never touches a clock and gives the same answer on the server and in the
 * browser. A day in the future reads as "today": a file stamped ahead of the
 * clock is a machine's problem, not something to report to the user.
 */
export function relativeDay(day: string, today: string): string {
	const [from, to] = [day, today].map((d) => {
		const [y, m, date] = d.split('-').map(Number);
		return Date.UTC(y, m - 1, date);
	});
	const days = Math.round((to - from) / 86_400_000);
	if (days <= 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 14) return `${days} days ago`;
	if (days < 60) return `${Math.round(days / 7)} weeks ago`;
	return day;
}

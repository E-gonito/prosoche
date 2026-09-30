/** Shared between server and browser, so it must not import anything server-only. */
export function formatMinutes(minutes: number): string {
	return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

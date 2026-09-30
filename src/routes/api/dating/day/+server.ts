import { isDayKey } from '$server/daily';
import { saveDay } from '$server/dating';
import { refuse, route, str } from '../../route';

/** A non-negative integer, from anything the browser might send. */
function whole(n: unknown): number {
	const v = typeof n === 'number' ? n : Number(n);
	return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Save one day of the Like Ledger: `{ day, sent, matches, type, received,
 * notes, expectedHash }`. Answers `{ hash }`; a ledger that changed on
 * another device since the page loaded is a 409 and nothing is written.
 */
export const POST = route(async ({ body, hub }) => {
	const day = str(body.day);
	const expectedHash = str(body.expectedHash);
	if (!day || !isDayKey(day)) return refuse('invalid', 'day must be YYYY-MM-DD');
	if (expectedHash === undefined) return refuse('invalid', 'expectedHash is required');
	const counts = { sent: whole(body.sent), matches: whole(body.matches), type: whole(body.type), received: whole(body.received) };
	return saveDay(hub.vault, day, counts, str(body.notes) ?? '', expectedHash);
});

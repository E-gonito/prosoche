import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey } from '$server/daily';
import { saveDay } from '$server/dating';
import type { RequestHandler } from './$types';

/**
 * Save one day of the Like Ledger.
 *
 * A conflict — the ledger changed on another device since the client loaded
 * this day — comes back as 409, the same shape every other write in this app
 * uses, so the browser's page can reload rather than clobber it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as {
		day?: string;
		sent?: number;
		matches?: number;
		type?: number;
		received?: number;
		notes?: string;
		expectedHash?: string;
	};

	if (!body.day || !isDayKey(body.day)) return json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
	if (typeof body.expectedHash !== 'string') return json({ error: 'expectedHash is required' }, { status: 400 });

	const { vault, ready } = hub();
	await ready;

	const result = await saveDay(
		vault,
		body.day,
		{ sent: whole(body.sent), matches: whole(body.matches), type: whole(body.type), received: whole(body.received) },
		body.notes ?? '',
		body.expectedHash
	);

	if (!result.ok) return json({ error: 'That day changed on another device. Reloading.' }, { status: 409 });
	return json({ ok: true, hash: result.hash });
};

/** A non-negative integer, from anything the browser might send. */
function whole(n: unknown): number {
	const v = typeof n === 'number' ? n : Number(n);
	return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

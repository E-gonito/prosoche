import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey } from '$server/daily';
import { openDay } from '$server/daily-note';
import type { RequestHandler } from './$types';

/** Create the day's note from the template. Idempotent. */
export const POST: RequestHandler = async ({ params }) => {
	if (!isDayKey(params.day)) return json({ error: 'Not a date' }, { status: 400 });
	const note = await openDay(hub().vault, params.day);
	return json({ ok: true, path: note.path, created: note.exists });
};

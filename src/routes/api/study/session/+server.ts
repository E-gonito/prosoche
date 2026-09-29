import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { logSession } from '$server/study/sessions';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	day?: string;
	minutes?: number;
	topic?: string | null;
	note?: string;
}

/**
 * Log a study session, appended under its `## YYYY-MM` heading in
 * `Sessions.md`. Answers 409 when the note changed while we were reading it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.path || !body.day || !body.minutes || body.minutes <= 0) {
		return json({ error: 'path, day and a positive number of minutes are required' }, { status: 400 });
	}

	const result = await logSession(hub().vault, body.path, {
		day: body.day,
		minutes: Math.round(body.minutes),
		topic: body.topic?.trim() || null,
		note: body.note?.trim() ?? ''
	});
	if (result.ok) return json({ ok: true, entry: result.entry });
	return json({ error: 'That note changed on another device.' }, { status: 409 });
};

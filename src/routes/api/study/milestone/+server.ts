import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addMilestone } from '$server/study/goals';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	heading?: string;
	text?: string;
	due?: string | null;
}

/**
 * Append a milestone under an existing goal, as a task line. Answers 404 when
 * the note holding the goal is not there, and 409 when it changed while we
 * were reading it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.path || !body.heading || !body.text?.trim()) {
		return json({ error: 'path, heading and text are required' }, { status: 400 });
	}

	const result = await addMilestone(hub().vault, body.path, body.heading, body.text.trim(), body.due?.trim() || null);
	if (result.ok) return json({ ok: true, task: result.task });
	return json({ error: result.reason }, { status: result.reason === 'no-note' ? 404 : 409 });
};

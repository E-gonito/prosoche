import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addGoal } from '$server/study/goals';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	title?: string;
	target?: string | null;
}

/**
 * Append a new goal to a `Goals.md` note, creating it when this is the
 * first. Answers 409 when the note changed underneath while we read it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.path || !body.title?.trim()) return json({ error: 'path and title are required' }, { status: 400 });

	const result = await addGoal(hub().vault, body.path, body.title.trim(), body.target?.trim() || null);
	if (result.ok) return json({ ok: true });
	return json({ error: 'That note changed on another device.' }, { status: 409 });
};

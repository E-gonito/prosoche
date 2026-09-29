import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addGoal } from '$server/study/goals';
import { subjectOf } from '$server/study/subjects';
import type { RequestHandler } from './$types';

interface Body {
	subject?: string;
	title?: string;
	target?: string | null;
}

/**
 * Append a new goal to a subject's `Goals.md`, creating it when this is the
 * first. Answers 404 for a subject that is not there and 409 when the note
 * changed underneath while we read it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.subject || !body.title?.trim()) return json({ error: 'subject and title are required' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;
	const subject = subjectOf(await workspaces(), body.subject);
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const result = await addGoal(vault, subject.files.goals, body.title.trim(), body.target?.trim() || null);
	if (result.ok) return json({ ok: true });
	return json({ error: 'That note changed on another device.' }, { status: 409 });
};

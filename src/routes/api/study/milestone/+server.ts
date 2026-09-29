import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addMilestone } from '$server/study/goals';
import { subjectOf } from '$server/study/subjects';
import type { RequestHandler } from './$types';

interface Body {
	subject?: string;
	heading?: string;
	text?: string;
	due?: string | null;
}

/**
 * Append a milestone under an existing goal of a subject, as a task line.
 * Answers 404 when the subject or its `Goals.md` is not there, and 409 when
 * the note changed while we were reading it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.subject || !body.heading || !body.text?.trim()) {
		return json({ error: 'subject, heading and text are required' }, { status: 400 });
	}

	const { vault, ready, workspaces } = hub();
	await ready;
	const subject = subjectOf(await workspaces(), body.subject);
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const result = await addMilestone(vault, subject.files.goals, body.heading, body.text.trim(), body.due?.trim() || null);
	if (result.ok) return json({ ok: true, task: result.task });
	return json({ error: result.reason }, { status: result.reason === 'no-note' ? 404 : 409 });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { logSession } from '$server/study/sessions';
import { subjectOf } from '$server/study/subjects';
import type { RequestHandler } from './$types';

interface Body {
	subject?: string;
	day?: string;
	minutes?: number;
	/** The goal's name, written as `[[Goals#<goal>]]`; absent or null for none. */
	goal?: string | null;
	note?: string;
}

/**
 * Log a study session in a subject's `Sessions.md`, appended under its
 * `## YYYY-MM` heading. Answers 404 for a subject that is not there and 409
 * when the note changed while we were reading it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.subject || !body.day || !/^\d{4}-\d{2}-\d{2}$/.test(body.day) || !body.minutes || body.minutes <= 0) {
		return json({ error: 'subject, day and a positive number of minutes are required' }, { status: 400 });
	}

	const { vault, ready, workspaces } = hub();
	await ready;
	const subject = subjectOf(await workspaces(), body.subject);
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const result = await logSession(vault, subject.files.sessions, {
		day: body.day,
		minutes: Math.round(body.minutes),
		goal: typeof body.goal === 'string' ? body.goal.trim() || null : null,
		note: body.note?.trim() ?? ''
	});
	if (result.ok) return json({ ok: true, entry: result.entry });
	return json({ error: 'That note changed on another device.' }, { status: 409 });
};

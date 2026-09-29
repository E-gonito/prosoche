import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { changeReadingList } from '$server/study/reading';
import { subjectOf } from '$server/study/subjects';
import type { ReadingOp } from '$lib/shared/study';
import type { RequestHandler } from './$types';

/**
 * Change a subject's reading list: `{ subject, hash, op }`, where `hash` is
 * the list's hash as the page last saw it. Answers with the list as it now
 * is: 200 when the op was applied, 409 when the file had changed first, 422
 * when the op made no sense against it. The last two carry a sentence and
 * write nothing.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { subject?: string; hash?: string; op?: ReadingOp };
	if (!body.subject || typeof body.hash !== 'string' || !body.op) {
		return json({ error: 'subject, hash and op are required' }, { status: 400 });
	}

	const { vault, ready, workspaces } = hub();
	await ready;
	const subject = subjectOf(await workspaces(), body.subject);
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const result = await changeReadingList(vault, subject, body.hash, body.op);
	if (result.ok) return json({ list: result.list });
	if (result.reason === 'conflict') {
		return json({ error: 'The reading list changed somewhere else. It has been reloaded; try again.', list: result.list }, { status: 409 });
	}
	return json({ error: result.message, list: result.list }, { status: 422 });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addCards } from '$server/study/card-files';
import { subjectOf } from '$server/study/subjects';
import type { RequestHandler } from './$types';

/**
 * Add the cards a person ticked and edited on the Make cards page:
 * `{ subject, goal, cards: [{ question, answer, source }] }`.
 *
 * This is the accept step for drafted cards, and it runs no model: it writes
 * what it is sent, once `addCards` has checked all of it again. The card
 * file is chosen there from the subject and the goal, never taken from the
 * request. 404 for a subject that is not there, 422 with `problems` for
 * anything refused (nothing is written then), 409 when the card file changed
 * while it was being written.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { subject?: unknown; goal?: unknown; cards?: unknown };
	const { vault, ready, workspaces } = hub();
	await ready;

	const subject = subjectOf(await workspaces(), typeof body.subject === 'string' ? body.subject : '');
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const result = await addCards(vault, subject, { goal: body.goal ?? null, cards: body.cards });
	if (result.ok) return json({ path: result.path, added: result.added, skipped: result.skipped, goal: result.goal });
	return json({ error: result.problems[0], problems: result.problems }, { status: result.reason === 'conflict' ? 409 : 422 });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { setCardFileGoal } from '$server/study/flashcards';
import { subjectOf } from '$server/study/subjects';
import type { RequestHandler } from './$types';

interface Body {
	subject?: string;
	path?: string;
	/** The goal's name, or null to put the file under no goal. */
	goal?: string | null;
}

/**
 * Put a card file under a goal, writing `goal:` into its frontmatter. The
 * file must be one of the subject's card files: 404 for a subject or note
 * that is not there, 422 for a note outside the subject or with no cards,
 * 409 when it changed while we were writing.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.subject || !body.path) return json({ error: 'subject and path are required' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;
	const subject = subjectOf(await workspaces(), body.subject);
	if (!subject) return json({ error: 'There is no such subject.' }, { status: 404 });

	const goal = typeof body.goal === 'string' ? body.goal.trim() || null : null;
	const result = await setCardFileGoal(vault, subject.scope, body.path, goal);
	if (result.ok) return json({ ok: true });
	const status = result.reason === 'no-note' ? 404 : result.reason === 'conflict' ? 409 : 422;
	const error = result.reason === 'not-cards' ? `That is not one of ${subject.name}'s card files.` : result.reason;
	return json({ error }, { status });
};

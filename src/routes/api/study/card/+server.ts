import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { review, scanCards } from '$server/study/flashcards';
import { recordIntroduced } from '$server/study/new-cards';
import { subjectsOf } from '$server/study/subjects';
import { GRADES, type Grade } from '$lib/shared/sm2';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	line?: number;
	index?: number;
	/** The schedule line as the browser last saw it, for conflict detection. */
	expectedRaw?: string;
	grade?: Grade;
}

/**
 * Grade one card.
 *
 * The body says which card and what the browser last saw; everything else,
 * including the card's current schedule, is read back out of the note, so a
 * stale page cannot post a schedule of its own. Answers 409 when the line
 * changed underneath, which the review page shows as a refusal rather than an
 * error, and 404 when the card is no longer there at all.
 *
 * A card graded for the first time is counted as one of today's new cards
 * for each subject whose folders hold it, so the queues let in no more.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	if (!body.path || typeof body.line !== 'number' || !body.grade || !GRADES.includes(body.grade)) {
		return json({ error: 'path, line and a grade of again, hard, good or easy are required' }, { status: 400 });
	}

	const { vault, workspaces } = hub();
	const note = await vault.read(body.path);
	if (!note.exists) return json({ error: 'No such note' }, { status: 404 });

	const wanted = body.index ?? 0;
	const card = scanCards(note.content, body.path).find((c) => c.line === body.line && c.index === wanted);
	if (!card) return json({ error: 'That card is no longer in the note' }, { status: 404 });
	if (typeof body.expectedRaw === 'string' && card.expectedRaw !== body.expectedRaw) {
		return json({ error: 'That card changed', current: card.expectedRaw }, { status: 409 });
	}

	const day = today();
	const result = await review(vault, card, body.grade, day);
	if (!result.ok) {
		return json({ error: result.reason, current: result.current }, { status: result.reason === 'no-note' ? 404 : 409 });
	}
	if (card.schedule === null) await recordIntroduced(vault, subjectsOf(await workspaces()), card.path, note.content, day);
	return json({ ok: true, card: result.card, shift: result.shift });
};

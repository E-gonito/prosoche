import { json, text } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { dueCards, review, scanCards } from '$server/study/flashcards';
import { ankiDeck, ankiFilename } from '$server/study/anki';
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
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	if (!body.path || typeof body.line !== 'number' || !body.grade || !GRADES.includes(body.grade)) {
		return json({ error: 'path, line and a grade of again, hard, good or easy are required' }, { status: 400 });
	}

	const { vault } = hub();
	const note = await vault.read(body.path);
	if (!note.exists) return json({ error: 'No such note' }, { status: 404 });

	const wanted = body.index ?? 0;
	const card = scanCards(note.content, body.path).find((c) => c.line === body.line && c.index === wanted);
	if (!card) return json({ error: 'That card is no longer in the note' }, { status: 404 });
	if (typeof body.expectedRaw === 'string' && card.expectedRaw !== body.expectedRaw) {
		return json({ error: 'That card changed', current: card.expectedRaw }, { status: 409 });
	}

	const result = await review(vault, card, body.grade, today());
	if (!result.ok) {
		return json({ error: result.reason, current: result.current }, { status: result.reason === 'no-note' ? 404 : 409 });
	}
	return json({ ok: true, card: result.card, shift: result.shift });
};

/**
 * Download the cards in scope as an Anki-importable file.
 *
 * `deck` names the Anki deck; `folder` and `tag` repeat to give the scope, and
 * an empty scope is the whole vault. The response is a download: nothing is
 * written anywhere, least of all into `Flashcards/`, whose eighty existing
 * exports this never reads or touches.
 */
export const GET: RequestHandler = async ({ url }) => {
	const { vault, index, ready } = hub();
	await ready;

	const scope = { folders: url.searchParams.getAll('folder'), tags: url.searchParams.getAll('tag') };
	const deck = url.searchParams.get('deck') || 'Flashcards';
	// Every card in scope, not only what is due: an export is the whole deck.
	const queue = await dueCards(vault, index, { on: '9999-12-31', scope, limit: 100_000 });

	return text(ankiDeck(queue.cards, { name: deck, tags: scope.folders }), {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'content-disposition': `attachment; filename="${ankiFilename(deck)}"`
		}
	});
};

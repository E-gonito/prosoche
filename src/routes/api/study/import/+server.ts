import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { importAnkiDecks } from '$server/study/anki-decks';
import { studyHome } from '$server/study/subjects';
import type { RequestHandler } from './$types';

/**
 * Import the Anki decks under `Flashcards/` into subject `{ subject }`: write a
 * card file for every deck named in `sources` (every deck, when absent) that
 * does not have one yet, and answer with every
 * deck and what happened to it. Which decks and where they go is decided
 * here, from the vault as it is now, never from what the preview page last
 * saw. 404 for a slug that is not a subject.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { subject?: unknown; sources?: unknown };
	const { vault, ready, workspaces } = hub();
	await ready;

	const home = studyHome(await workspaces(), typeof body.subject === 'string' ? body.subject : '');
	if (!home) return json({ error: 'There is no study subject by that name.' }, { status: 404 });
	const only = Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === 'string') : undefined;
	return json({ decks: await importAnkiDecks(vault, home, { apply: true, only }) });
};

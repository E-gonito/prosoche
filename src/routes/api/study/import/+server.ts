import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { importAnkiDecks } from '$server/study/anki-decks';
import { studyContext } from '$server/study/topics';
import type { RequestHandler } from './$types';

/**
 * Import the Anki decks under `Flashcards/`: write a card file for every deck
 * that does not have one yet, and answer with every deck and what happened to
 * it. The body is ignored; which decks and where they go is decided here, from
 * the vault as it is now, never from what the preview page last saw.
 */
export const POST: RequestHandler = async () => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const { home } = await studyContext(workspaces);
	return json({ decks: await importAnkiDecks(vault, home, { apply: true }) });
};

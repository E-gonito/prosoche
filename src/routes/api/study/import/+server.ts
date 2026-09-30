import { importAnkiDecks } from '$server/study/anki-decks';
import { studyHome } from '$server/study/subjects';
import { refuse, route, strings } from '../../route';

/**
 * Import the Anki decks under `Flashcards/` into subject `{ subject }`: write a
 * card file for every deck named in `sources` (every deck, when absent) that
 * does not have one yet, and answer `{ decks }`, every deck and what happened
 * to it. Which decks and where they go is decided here, from the vault as it
 * is now, never from what the preview page last saw.
 */
export const POST = route(async ({ body, hub }) => {
	const home = studyHome(await hub.workspaces(), body.subject);
	if (!home) return refuse('not-found', 'There is no study subject by that name.');
	return { decks: await importAnkiDecks(hub.vault, home, { apply: true, only: strings(body.sources) }) };
});

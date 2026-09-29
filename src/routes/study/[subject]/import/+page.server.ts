import { hub } from '$server/hub';
import { importAnkiDecks } from '$server/study/anki-decks';
import { error } from '@sveltejs/kit';
import { studyHome } from '$server/study/subjects';
import type { PageServerLoad } from './$types';

/** The Anki import's preview: every deck and what Import would do with it. Writes nothing. */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const home = studyHome(await workspaces(), params.subject);
	if (!home) error(404, 'There is no study subject by that name.');
	return { home, decks: await importAnkiDecks(vault, home) };
};

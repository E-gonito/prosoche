import { hub } from '$server/hub';
import { importAnkiDecks } from '$server/study/anki-decks';
import { studyContext } from '$server/study/topics';
import type { PageServerLoad } from './$types';

/** The Anki import's preview: every deck and what Import would do with it. Writes nothing. */
export const load: PageServerLoad = async () => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const { home } = await studyContext(workspaces);
	return { home, decks: await importAnkiDecks(vault, home) };
};

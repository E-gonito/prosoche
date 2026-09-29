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
	// Deck folders whose name matches one of the subject's own folders start
	// ticked, so Computer Science's decks are chosen for a subject that keeps
	// Computer Science/ and Wisdom's are not.
	const ws = (await workspaces()).find((w) => w.slug === params.subject);
	const own = (ws?.folders ?? []).map((f) => f.replace(/\/+$/, '').split('/').pop()!.toLowerCase());
	return { home, own, decks: await importAnkiDecks(vault, home) };
};

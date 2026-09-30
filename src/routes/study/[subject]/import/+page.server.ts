import { hub } from '$server/hub';
import { importAnkiDecks } from '$server/study/anki-decks';
import type { PageServerLoad } from './$types';

/** The Anki import's preview: every deck and what Import would do with it. Writes nothing. */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault } = await hub();
	// Deck folders whose name matches one of the subject's own folders start
	// ticked, so Computer Science's decks are chosen for a subject that keeps
	// Computer Science/ and Wisdom's are not.
	const own = (subject.scope.folders ?? []).map((f) => f.replace(/\/+$/, '').split('/').pop()!.toLowerCase());
	return { home: subject.home, own, decks: await importAnkiDecks(vault, subject.home) };
};

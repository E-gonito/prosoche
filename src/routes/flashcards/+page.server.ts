import { hub } from '$server/hub';
import { today } from '$server/daily';
import { flashcardsOverview } from '$server/flashcards/decks';
import type { PageServerLoad } from './$types';

/**
 * The Flashcards page: every glossary's deck with its categories and what
 * is due in each, everything due across them, and the new cards a day they
 * share.
 */
export const load: PageServerLoad = async () => {
	const { vault, workspaces } = await hub();
	return flashcardsOverview(vault, await workspaces(), today());
};

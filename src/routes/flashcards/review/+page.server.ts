import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { deckReview } from '$server/flashcards/decks';
import type { PageServerLoad } from './$types';

/**
 * One review session: every deck's cards, the decks taking turns, or one
 * deck's with `?deck=<slug>`, or one of its categories' with
 * `&category=<name>` too. The queue is fixed at page load. A deck or a
 * category there is not is a 404.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault, workspaces } = await hub();
	const day = today();
	const filter = { deck: url.searchParams.get('deck') || undefined, category: url.searchParams.get('category') || undefined };
	const review = await deckReview(vault, await workspaces(), day, filter);
	if (!review) error(404, filter.category ? 'That deck has no such category.' : 'There is no such deck.');
	return { today: day, ...review };
};

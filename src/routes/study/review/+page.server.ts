import { hub } from '$server/hub';
import { today } from '$server/daily';
import { dueCards } from '$server/study/flashcards';
import { scopeOf } from '$server/study/topics';
import type { PageServerLoad } from './$types';

/**
 * The cards for one review session, fixed at page load.
 *
 * The session is a list, not a live query: grading a card must not reshuffle
 * the queue under the user's thumb. `?ws=<slug>` scopes it the same way the
 * dashboard does.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const asked = url.searchParams.get('ws');
	const workspace = asked ? (defs.find((w) => w.slug === asked) ?? null) : (defs.find((w) => w.template === 'study') ?? null);

	const day = today();
	const queue = await dueCards(vault, index, { on: day, scope: scopeOf(workspace), limit: 120 });

	return {
		today: day,
		cards: queue.cards,
		total: queue.total,
		workspace: workspace ? { slug: workspace.slug, name: workspace.name } : null
	};
};

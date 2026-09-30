import { hub } from '$server/hub';
import { today } from '$server/daily';
import { subjectsOf } from '$server/study/subjects';
import { dueEverywhere } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * One review session over everything due in every subject: where Today's
 * flashcards card and the Study index's "Review everything due" lead. The
 * queue is fixed at page load.
 */
export const load: PageServerLoad = async () => {
	const { vault, index, workspaces } = await hub();

	const day = today();
	const queue = await dueEverywhere(vault, index, subjectsOf(await workspaces()), day);
	return { today: day, cards: queue.cards, total: queue.total };
};

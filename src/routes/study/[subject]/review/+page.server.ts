import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * One review session over a subject's cards, or over one goal's with
 * `?goal=<slug>`. The queue is fixed at page load: grading a card must not
 * reshuffle it under the user's thumb.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
	const { subject } = await parent();
	const { vault, index } = await hub();

	const day = today();
	const wanted = url.searchParams.get('goal') || undefined;
	const summary = await studySummary(vault, index, subject, day, wanted);
	const goal = wanted ? (summary.goalRefs.find((g) => g.slug === wanted)?.name ?? wanted) : null;

	return { today: day, goal, cards: summary.cards.cards, total: summary.cards.total };
};

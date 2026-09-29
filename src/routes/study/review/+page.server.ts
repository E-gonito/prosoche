import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, studyTabs } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * The cards for one review session, fixed at page load: grading a card must
 * not reshuffle the queue under the user's thumb.
 */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const day = today();
	const summary = await studySummary(vault, index, workspaces, day);

	return {
		today: day,
		tabs: studyTabs(summary),
		cards: summary.cards.cards,
		total: summary.cards.total
	};
};

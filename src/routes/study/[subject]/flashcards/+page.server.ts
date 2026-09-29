import { hub } from '$server/hub';
import { today } from '$server/daily';
import { filesByGoal, studySummary } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * A subject's card files, grouped by the goal each one's frontmatter names,
 * with what is due in each, today's new cards and how many more wait, and
 * the notes holding cards Obsidian cannot see.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault, index, ready } = hub();
	await ready;

	const summary = await studySummary(vault, index, subject, today());
	const groups = filesByGoal(summary);
	return {
		groups,
		goals: summary.goalRefs,
		due: groups.reduce((sum, g) => sum + g.due, 0),
		total: summary.cards.total,
		fresh: summary.cards.fresh,
		waiting: summary.cards.waiting,
		invisible: summary.cards.invisible
	};
};

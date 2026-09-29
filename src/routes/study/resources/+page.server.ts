import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, studyTabs } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/** The reading list, grouped by status on the page itself. */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const summary = await studySummary(vault, index, workspaces, today());

	return { tabs: studyTabs(summary), resources: summary.resources };
};

import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, studyTabs } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/** Goals and their milestones, read straight from `Goals.md`. */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const summary = await studySummary(vault, index, workspaces, today());

	return {
		tabs: studyTabs(summary),
		goalsPath: summary.goalsPath,
		weeklyHours: summary.goals.weeklyHours,
		goals: summary.goals.goals
	};
};

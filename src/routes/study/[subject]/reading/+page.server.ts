import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/** A subject's reading list, and the goals an item can point at. */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault, index, ready } = hub();
	await ready;

	const summary = await studySummary(vault, index, subject, today());
	return { list: summary.reading, goals: summary.goalRefs };
};

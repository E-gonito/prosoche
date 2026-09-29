import { hub } from '$server/hub';
import { today } from '$server/daily';
import { subjectsOf } from '$server/study/subjects';
import { dueEverywhere, studySummary, subjectCard } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * The Study index: one card per subject — its goals, this week's hours and
 * the cards due — and everything due across them all.
 */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const day = today();
	const subjects = subjectsOf(await workspaces());
	const [cards, all] = await Promise.all([
		Promise.all(subjects.map(async (s) => subjectCard(await studySummary(vault, index, s, day), day))),
		dueEverywhere(vault, index, subjects, day, 0)
	]);
	return { subjects: cards, due: all.due + all.fresh };
};

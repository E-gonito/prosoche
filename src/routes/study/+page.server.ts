import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, subjectCard } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/** The Study index: one card per subject — its goals, this week's hours and its streak. */
export const load: PageServerLoad = async () => {
	const { vault, subjects: readSubjects } = await hub();
	const day = today();
	const subjects = await readSubjects();
	return { subjects: await Promise.all(subjects.map(async (s) => subjectCard(await studySummary(vault, s), day))) };
};

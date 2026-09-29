import { hub } from '$server/hub';
import { readGoals } from '$server/study/goals';
import type { PageServerLoad } from './$types';

/** A subject's goals and their milestones, read straight from its `Goals.md`. */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault, ready } = hub();
	await ready;
	return await readGoals(vault, subject.files.goals);
};

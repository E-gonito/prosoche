import { hub } from '$server/hub';
import { today } from '$server/daily';
import { progressByGoal, studySummary, subjectCard } from '$server/study/summary';
import type { PageServerLoad } from './$types';

/**
 * A subject at a glance: each goal with its milestones, this week's hours,
 * the reading in progress and the cards due for it; the cards due in all,
 * this week's time against the target, and the streak; and the subject's
 * folders, with every folder in the vault to offer beside them.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault, index, ready } = hub();
	await ready;

	const day = today();
	const [summary, vaultFolders] = await Promise.all([studySummary(vault, index, subject, day), vault.folders()]);
	const card = subjectCard(summary, day);
	const { goals, unassigned } = progressByGoal(summary, day);

	return {
		goals,
		unassigned,
		due: card.due,
		fresh: summary.cards.fresh,
		weeklyHours: summary.goals.weeklyHours,
		weekMinutes: card.weekMinutes,
		streak: card.streak,
		folders: subject.scope.folders ?? [],
		vaultFolders
	};
};

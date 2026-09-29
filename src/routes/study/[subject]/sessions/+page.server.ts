import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary } from '$server/study/summary';
import { minutesByGoal, monthRange, weeklyMinutes } from '$server/study/sessions';
import type { PageServerLoad } from './$types';

/** A subject's session log: recent entries, hours per goal this month, and a week-by-week chart. */
export const load: PageServerLoad = async ({ parent }) => {
	const { subject } = await parent();
	const { vault, index, ready } = hub();
	await ready;

	const day = today();
	const summary = await studySummary(vault, index, subject, day);
	const month = monthRange(day);

	return {
		today: day,
		goals: summary.goalRefs,
		// Newest first, so the log reads like the inbox does.
		sessions: [...summary.sessions].sort((a, b) => b.day.localeCompare(a.day) || b.line - a.line),
		goalHours: minutesByGoal(summary.sessions, month.from, month.to),
		weeks: weeklyMinutes(summary.sessions, day, 8)
	};
};

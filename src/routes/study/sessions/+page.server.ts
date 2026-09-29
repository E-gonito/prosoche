import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, studyTabs } from '$server/study/summary';
import { minutesByTopic, weeklyMinutes } from '$server/study/sessions';
import { topicsIn } from '$server/study/topics';
import type { PageServerLoad } from './$types';

/** The session log: recent entries, hours per topic this month, and a week-by-week chart. */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const day = today();
	const summary = await studySummary(vault, index, workspaces, day);
	const topics = await topicsIn(vault, index, summary.scope);

	return {
		today: day,
		tabs: studyTabs(summary),
		sessionsPath: summary.sessionsPath,
		// Newest first, so the log reads like the inbox does.
		sessions: [...summary.sessions].sort((a, b) => b.day.localeCompare(a.day) || b.line - a.line),
		topics: [...new Set(topics.map((t) => t.name))].sort((a, b) => a.localeCompare(b)),
		topicHours: minutesByTopic(summary.sessions, day),
		weeks: weeklyMinutes(summary.sessions, day, 8)
	};
};

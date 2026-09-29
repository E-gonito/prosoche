import { hub } from '$server/hub';
import { today } from '$server/daily';
import { studySummary, studyTabs } from '$server/study/summary';
import { minutesThisWeek, streak } from '$server/study/sessions';
import { topicsIn } from '$server/study/topics';
import { isDone } from '$lib/shared/task';
import type { PageServerLoad } from './$types';

/**
 * Study at a glance: what is due right now, the goals under way, this week's
 * time against the target, the streak, and what is currently being read.
 */
export const load: PageServerLoad = async () => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const day = today();
	const summary = await studySummary(vault, index, workspaces, day);
	const topics = await topicsIn(vault, index, summary.scope);

	return {
		today: day,
		tabs: studyTabs(summary),
		due: summary.cards.cards.length,
		fresh: summary.cards.fresh,
		goals: summary.goals.goals.map((goal) => {
			const next = goal.milestones.find((m) => !isDone(m)) ?? null;
			return {
				title: goal.title,
				target: goal.target,
				done: goal.milestones.filter(isDone).length,
				total: goal.milestones.length,
				next: next ? { text: next.text, due: next.due } : null
			};
		}),
		weeklyHours: summary.goals.weeklyHours,
		weekMinutes: minutesThisWeek(summary.sessions, day),
		streak: streak(summary.sessions, day),
		currentlyReading: summary.resources.find((r) => r.status === 'learning') ?? null,
		// Top-level folders only, and a dozen at most: a compact list, not the map.
		topics: topics
			.filter((t) => t.parent === null)
			.map((t) => ({ name: t.name, notes: t.notes }))
			.slice(0, 12)
	};
};

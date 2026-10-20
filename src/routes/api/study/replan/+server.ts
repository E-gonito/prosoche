import { today } from '$server/daily';
import { replan } from '$server/study/goals';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route, str } from '../../route';

/**
 * Move a goal's late steps back onto the calendar, `{ subject, goal }`:
 * every open dated step later by the same number of days, so the earliest
 * late one is due today. Answers `{ shift, steps }`.
 */
export const POST = route(
	async ({ body, hub }) => {
		const goal = str(body.goal)?.trim();
		if (!body.subject || !goal) return refuse('invalid', 'subject and goal are required');
		const subject = subjectOf(await hub.subjects(), body.subject);
		return subject ? replan(hub.vault, subject.files.goals, goal, today()) : noSubject();
	},
	{ 'no-goal': 'That goal is no longer in Goals.md.', 'nothing-late': 'Nothing in that goal is late.' }
);

import { addMilestone } from '$server/study/goals';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route, str } from '../../route';

/**
 * Append a milestone, `{ subject, heading, text, due }`, under an existing
 * goal of a subject, as a task line. Answers `{ task }`; a goal or
 * `Goals.md` that is not there is a 404.
 */
export const POST = route(async ({ body, hub }) => {
	const heading = str(body.heading);
	const text = str(body.text)?.trim();
	if (!body.subject || !heading || !text) return refuse('invalid', 'subject, heading and text are required');
	const subject = subjectOf(await hub.workspaces(), body.subject);
	return subject ? addMilestone(hub.vault, subject.files.goals, heading, text, str(body.due)?.trim() || null) : noSubject();
});

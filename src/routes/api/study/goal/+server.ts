import { addGoal, setFocus } from '$server/study/goals';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route, str } from '../../route';

/** Append a new goal, `{ subject, title, target }`, to a subject's `Goals.md`, creating it when this is the first. */
export const POST = route(async ({ body, hub }) => {
	const title = str(body.title)?.trim();
	if (!body.subject || !title) return refuse('invalid', 'subject and title are required');
	const subject = subjectOf(await hub.subjects(), body.subject);
	return subject ? addGoal(hub.vault, subject.files.goals, title, str(body.target)?.trim() || null) : noSubject();
});

/**
 * Make a goal the one the subject's Overview shows, `{ subject, focus }`,
 * written as `focus:` in its `Goals.md`. Refuses a goal the note does not have.
 */
export const PATCH = route(async ({ body, hub }) => {
	const focus = str(body.focus)?.trim();
	if (!body.subject || !focus) return refuse('invalid', 'subject and focus are required');
	const subject = subjectOf(await hub.subjects(), body.subject);
	if (!subject) return noSubject();
	return setFocus(hub.vault, subject.files.goals, focus);
}, { 'no-goal': 'That goal is no longer in Goals.md.' });

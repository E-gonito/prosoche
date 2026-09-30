import { setCardFileGoal } from '$server/study/flashcards';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route, str } from '../../route';

/**
 * Put a card file under a goal, `{ subject, path, goal }`, writing `goal:`
 * into its frontmatter; a null or blank goal puts it under none. The file
 * must be one of the subject's card files.
 */
export const POST = route(async ({ body, hub }) => {
	const path = str(body.path);
	if (!body.subject || !path) return refuse('invalid', 'subject and path are required');
	const subject = subjectOf(await hub.subjects(), body.subject);
	if (!subject) return noSubject();
	const result = await setCardFileGoal(hub.vault, subject.scope, path, str(body.goal)?.trim() || null);
	return result.ok || result.reason !== 'not-cards' ? result : refuse('not-cards', `That is not one of ${subject.name}'s card files.`);
});

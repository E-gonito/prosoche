import { draftStepPlan } from '$server/ai/study-plan';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route } from '../../route';

/**
 * Draft a plan for one step, `{ subject, line }`, the step's line in the
 * subject's `Goals.md`. Answers a `DraftResult`, whose proposal goes to
 * `/api/ai/proposal` to be validated and applied. Never writes a note.
 */
export const POST = route(async ({ body, hub }) => {
	if (!body.subject || typeof body.line !== 'number') return refuse('invalid', 'subject and line are required');
	const subject = subjectOf(await hub.subjects(), body.subject);
	return subject ? draftStepPlan(hub.vault, subject, body.line) : noSubject();
});

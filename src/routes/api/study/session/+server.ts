import { isDayKey } from '$server/daily';
import { logSession } from '$server/study/sessions';
import { subjectOf } from '$server/study/subjects';
import { noSubject, refuse, route, str } from '../../route';

/**
 * Log a study session, `{ subject, day, minutes, goal, note }`, in a
 * subject's `Sessions.md`, appended under its `## YYYY-MM` heading. Answers
 * `{ entry }`.
 */
export const POST = route(async ({ body, hub }) => {
	const day = str(body.day);
	const minutes = typeof body.minutes === 'number' ? Math.round(body.minutes) : 0;
	if (!body.subject || !day || !isDayKey(day) || minutes <= 0) {
		return refuse('invalid', 'subject, day and a positive number of minutes are required');
	}
	const subject = subjectOf(await hub.workspaces(), body.subject);
	if (!subject) return noSubject();
	return logSession(hub.vault, subject.files.sessions, {
		day,
		minutes,
		goal: str(body.goal)?.trim() || null,
		note: str(body.note)?.trim() ?? ''
	});
});

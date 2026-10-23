import { today } from '$server/daily';
import { focusSettings } from '$server/focus/settings';
import { endSession, extendSession, startSession } from '$server/study/session';
import { studySummary } from '$server/study/summary';
import { subjectOf } from '$server/study/subjects';
import type { Outcome } from '$lib/shared/study';
import { noSubject, refuse, route, str } from '../../route';

const OUTCOMES = ['done', 'progress', 'skipped'];
/** "+15 min" is the one step; a request for more is clamped, not refused. */
const MAX_EXTEND = 120;

/**
 * Run a study session. `{ action: 'start', subject }` starts one on the
 * subject's active step; `{ action: 'extend', minutes }` lengthens the running
 * one, and its block in today's note; `{ action: 'end', subject, outcome,
 * note }` ends it with `done`, `progress` or `skipped`. Answers the session
 * (start, extend) or what ending wrote (`minutes`, `warnings`). Only one
 * session runs at a time.
 */
export const POST = route(async ({ body, hub }) => {
	const now = Date.now();
	if (body.action === 'extend') {
		const minutes = typeof body.minutes === 'number' ? Math.min(MAX_EXTEND, Math.max(1, Math.round(body.minutes))) : 15;
		return extendSession(hub.vault, minutes);
	}
	const subject = subjectOf(await hub.subjects(), body.subject);
	if (!subject) return noSubject();
	if (body.action === 'start') return startSession(hub.vault, subject, await studySummary(hub.vault, subject), today(new Date(now)), now, (await focusSettings(hub.vault)).warmupMin);
	if (body.action === 'end') {
		const outcome = str(body.outcome);
		if (!outcome || !OUTCOMES.includes(outcome)) return refuse('invalid', 'outcome must be done, progress or skipped');
		return endSession(hub.vault, subject, outcome as Outcome, str(body.note) ?? '', now);
	}
	return refuse('invalid', 'action must be start, extend or end');
}, { busy: 'Another session is running.', 'no-step': 'This subject has no open step.', 'no-session': 'No session is running.' });

import { isDayKey } from '$server/daily';
import { endSession, extendSession, startBlockSession } from '$server/focus/session';
import { focusSettings } from '$server/focus/settings';
import type { Outcome } from '$lib/shared/study';
import { refuse, route, str } from '../route';

const OUTCOMES = ['done', 'progress', 'skipped'];
/** "+15 min" is the one step; a request for more is clamped, not refused. */
const MAX_EXTEND = 120;

/**
 * Run the focus session, for any block.
 *
 * - `{ action: 'start', day, line, raw }` starts one on the block at `line` of
 *   `day`'s note whose text is `raw`. Answers the session; the one already
 *   running if it is for that block; refuses `busy`, `moved` or `not-a-block`.
 * - `{ action: 'extend', minutes }` lengthens the running one, and its block in
 *   the note. Answers the session.
 * - `{ action: 'end', outcome, note }` ends it with `done`, `progress` or
 *   `skipped`. Answers what ending wrote (`minutes`, `warnings`).
 *
 * Only one session runs at a time. Study sessions are started from a subject
 * (`/api/study/session`) and extended and ended here like any other.
 */
export const POST = route(
	async ({ body, hub }) => {
		const now = Date.now();
		if (body.action === 'start') {
			const day = str(body.day);
			const raw = str(body.raw);
			if (!day || !isDayKey(day)) return refuse('bad-day');
			if (raw === undefined || typeof body.line !== 'number' || !Number.isInteger(body.line) || body.line < 0) return refuse('invalid', 'start needs day, line and raw');
			return startBlockSession(hub.vault, { day, line: body.line, raw }, now, (await focusSettings(hub.vault)).warmupMin);
		}
		if (body.action === 'extend') {
			const minutes = typeof body.minutes === 'number' ? Math.min(MAX_EXTEND, Math.max(1, Math.round(body.minutes))) : 15;
			return extendSession(hub.vault, minutes);
		}
		if (body.action === 'end') {
			const outcome = str(body.outcome);
			if (!outcome || !OUTCOMES.includes(outcome)) return refuse('invalid', 'outcome must be done, progress or skipped');
			return endSession(hub.vault, outcome as Outcome, str(body.note) ?? '', now);
		}
		return refuse('invalid', 'action must be start, extend or end');
	},
	{
		busy: 'Another session is running.',
		moved: 'That block is not in the note any more.',
		'not-a-block': 'That is not an open block with a start and an end time.',
		'no-session': 'No session is running.'
	}
);

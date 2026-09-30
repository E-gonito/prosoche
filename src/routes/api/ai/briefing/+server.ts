import { isDayKey, today } from '$server/daily';
import { run } from '$server/ai/briefing';
import { route, str } from '../../route';

/**
 * Draft the briefing for `{ day }`, today when absent or not a date.
 *
 * POST because it spends a run of the model, not because it writes: nothing
 * here touches the vault. Answers with a `DraftResult` whose proposal goes
 * through `/api/ai/proposal` like any other, and a 200 even when the run
 * produced only a problem, because "over budget" is an answer the card shows.
 */
export const POST = route<{ day: string }>(({ body, hub }) => {
	const day = str(body.day);
	return run(hub, day && isDayKey(day) ? day : today());
});

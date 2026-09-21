import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { run } from '$server/ai/briefing';
import type { RequestHandler } from './$types';

/**
 * Regenerate the briefing for a day.
 *
 * POST rather than GET because it writes: the marker region of that day's
 * note is replaced under G1's exception. The page load reads the region out
 * of the note like any other text, so there is no GET here to duplicate it.
 *
 * Responds 200 with whatever the run produced, including its problem, because
 * "the model was over budget" is an answer the card shows rather than an
 * error the browser catches.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { day } = (await request.json().catch(() => ({}))) as { day?: string };
	const when = day && isDayKey(day) ? day : today();
	const { vault, index, ready } = hub();
	await ready;
	return json({ briefing: await run({ vault, index }, when, { regenerate: true }) });
};

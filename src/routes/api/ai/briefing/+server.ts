import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { run } from '$server/ai/briefing';
import type { RequestHandler } from './$types';

/**
 * Draft the briefing for a day.
 *
 * POST because it spends a run of the model, not because it writes: nothing
 * here touches the vault. It returns a proposal for the browser to run
 * through `/api/ai/proposal`, the same as any other drafting feature, and
 * `destinations` names the one note that proposal is allowed to touch, for
 * the path policy. The page load reads the region out of the note like any
 * other text, so there is no GET here to duplicate it.
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
	const briefing = await run({ vault, index }, when, { regenerate: true });
	return json({ briefing, destinations: briefing.proposal?.edits.map((e) => e.path) ?? [] });
};

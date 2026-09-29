import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { gatherInsightsSource } from '$server/dating';
import { runDatingInsights } from '$server/ai/dating-insights';
import type { RequestHandler } from './$types';

/**
 * Insights, on demand. Reads the ledger and every dates log through
 * `dating.ts`'s own private-scope gather, then asks Claude read-only. Never
 * writes; there is no proposal here, because a read on screen is all this
 * feature is.
 */
export const POST: RequestHandler = async () => {
	const { vault, ready } = hub();
	await ready;

	const source = await gatherInsightsSource(vault);
	const result = await runDatingInsights(vault, source);
	return json(result);
};

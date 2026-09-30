import { gatherInsightsSource } from '$server/dating';
import { runDatingInsights } from '$server/ai/dating-insights';
import { route } from '../../route';

/**
 * Insights, on demand. Reads the ledger and every dates log through
 * `dating.ts`'s own private-scope gather, then asks Claude read-only. Never
 * writes; there is no proposal here, because a read on screen is all this
 * feature is.
 */
export const POST = route(async ({ hub: { vault } }) => runDatingInsights(vault, await gatherInsightsSource(vault)));

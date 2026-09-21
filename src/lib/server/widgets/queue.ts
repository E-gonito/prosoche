/**
 * What to read or watch next.
 *
 * The order is `queue`'s, stated in full on that function: finish what you
 * started, then fill the biggest hole in the topic map, then oldest first.
 * The coverage it needs comes from the same cached sweep of the vault the
 * other study widgets use, so adding this widget to a tab costs one pass.
 */

import { queue, resources } from '$server/study/resources';
import { coverage, scopeOf, topicsIn } from '$server/study/topics';
import { dueCards } from '$server/study/flashcards';
import type { WidgetContext } from '../widgets';

/** The next eight things, and how many are waiting behind them. */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const scope = scopeOf(ctx.workspace);
	const [all, topics, cards] = await Promise.all([
		resources(ctx.vault, ctx.index, scope),
		topicsIn(ctx.vault, ctx.index, scope),
		dueCards(ctx.vault, ctx.index, { on: ctx.today, scope, limit: 0 })
	]);

	const next = queue(all, coverage(topics, all, cards.cards, ctx.today));
	return { items: next.slice(0, 8), total: next.length };
}

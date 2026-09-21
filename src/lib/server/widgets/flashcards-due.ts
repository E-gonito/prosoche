/**
 * Cards scheduled for review, for whichever part of the vault the tab covers.
 *
 * Scoped by the workspace's folders and tag, so this widget on the CS study
 * page shows computer science cards and the same widget on a language
 * workspace would show that workspace's, with no per-page code.
 */

import { dueCards } from '$server/study/flashcards';
import { scopeOf } from '$server/study/topics';
import type { WidgetContext } from '../widgets';

/**
 * Counts, a peek at the next few cards, and where to go to review them.
 * Reads the vault; never writes. An empty scope is the whole vault.
 */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const scope = scopeOf(ctx.workspace);
	const queue = await dueCards(ctx.vault, ctx.index, { on: ctx.today, scope, limit: 60 });

	const decks = new Map<string, number>();
	for (const card of queue.cards) decks.set(card.deck, (decks.get(card.deck) ?? 0) + 1);

	return {
		on: ctx.today,
		due: queue.due,
		fresh: queue.fresh,
		total: queue.total,
		waiting: queue.cards.length,
		decks: [...decks.entries()].map(([deck, count]) => ({ deck, count })).sort((a, b) => b.count - a.count),
		invisible: queue.invisible.slice(0, 3),
		peek: queue.cards.slice(0, 3).map((c) => ({ question: c.question, context: c.context })),
		reviewHref: ctx.workspace ? `/study/review?ws=${encodeURIComponent(ctx.workspace.slug)}` : '/study/review'
	};
}

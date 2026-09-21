/**
 * The topic map: what the user is learning, and what nothing is pointing at.
 *
 * Topics come from folders, syllabus headings and any note declaring
 * `type: topic`; see `study/topics.ts` for why, and for what the
 * specification assumed instead.
 */

import { coverage, scopeOf, topicsIn } from '$server/study/topics';
import { resources } from '$server/study/resources';
import { dueCards } from '$server/study/flashcards';
import type { WidgetContext } from '../widgets';

/**
 * Every topic in scope with its coverage, parents before children so the
 * component can nest them without sorting. Reads only.
 */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const scope = scopeOf(ctx.workspace);
	const [topics, all, cards] = await Promise.all([
		topicsIn(ctx.vault, ctx.index, scope),
		resources(ctx.vault, ctx.index, scope),
		dueCards(ctx.vault, ctx.index, { on: ctx.today, scope, limit: 0 })
	]);

	const covered = coverage(topics, all, cards.cards, ctx.today);
	return {
		topics: covered,
		gaps: covered.filter((t) => t.state === 'gap').length,
		full: covered.filter((t) => t.state === 'covered').length
	};
}

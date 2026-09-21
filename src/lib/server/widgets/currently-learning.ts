/**
 * What the user is part way through: courses, books, videos and articles with
 * a status of `learning`.
 *
 * The same widget the CS study page uses is on the Personal dashboard, where
 * its scope is a different pair of folders. Nothing here knows which page it
 * is on; the workspace decides.
 */

import { resources } from '$server/study/resources';
import { scopeOf } from '$server/study/topics';
import type { Resource } from '$lib/shared/study';
import type { WidgetContext } from '../widgets';

/** Up to six things in progress, most recently touched first, plus the tallies. */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const all = await resources(ctx.vault, ctx.index, scopeOf(ctx.workspace));
	const count = (status: Resource['status']) => all.filter((r) => r.status === status).length;
	return {
		items: all.filter((r) => r.status === 'learning').slice(0, 6),
		learning: count('learning'),
		queued: count('queued'),
		paused: count('paused'),
		done: count('done')
	};
}

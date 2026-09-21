/**
 * The `time` widget: this week's planned against actual.
 *
 * Scoped to the workspace whose tab it sits on, or to the whole vault on a page
 * that has no workspace. All the work is in `timelog`; this only decides that
 * "this week" means the Monday-to-Sunday week containing today.
 */

import { weekOf, weekSummary } from '../timelog';
import type { WidgetContext } from '../widgets';

/** Reads the week's daily notes. Writes nothing. */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const days = weekOf(ctx.today);
	const summary = await weekSummary(ctx.vault, ctx.index, {
		days,
		workspaces: ctx.workspaces,
		workspace: ctx.workspace
	});
	return { ...summary, today: ctx.today, workspace: ctx.workspace?.name ?? null };
}

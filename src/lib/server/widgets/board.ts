/**
 * The `board` widget: a workspace's kanban.
 *
 * All of the thinking is in `$server/board`; this adds the workspace's own
 * identity, which the browser needs to create a card or move one. A page with
 * no workspace gets an empty board rather than an error: the catalogue lets
 * any widget be placed anywhere, and a board without a workspace simply has
 * nothing to show.
 */

import { buildBoard } from '../board';
import type { BoardWidget } from '../../shared/board';
import type { WidgetContext } from '../widgets';

export async function load(ctx: WidgetContext): Promise<BoardWidget> {
	const { workspace } = ctx;
	if (!workspace) return { workspace: null, columns: [], excluded: 0, candidates: [], deck: '' };
	return {
		workspace: { slug: workspace.slug, name: workspace.name },
		...buildBoard(ctx.index, workspace, ctx.workspaces)
	};
}

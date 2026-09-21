/**
 * The `pinned` widget: anything the user tagged `#pin`, wherever it lives.
 *
 * Pinning is the escape hatch from every filter this app applies: a line with
 * `#pin` shows up whatever folder it is in and whatever it lacks. Scoped to
 * the workspace when the widget sits on a workspace tab, and across the whole
 * vault otherwise, which is the same rule the rest of the page follows.
 *
 * Daily notes are included, unlike most cross-vault lists: the template
 * carries no `#pin`, so a pin inside today's note was put there on purpose.
 */

import { OPEN_STATUSES, type Task } from '../../shared/task';
import { config } from '../config';
import { workspaceFor } from '../workspaces';
import type { WorkspaceLabel } from './blocked';
import type { WidgetContext } from '../widgets';

export interface PinnedWidget {
	items: Array<{ task: Task; workspace: WorkspaceLabel | null }>;
	scope: string | null;
	/** The tag to remove to unpin, so the browser does not hardcode it. */
	tag: string;
}

/** The tag, without its `#`. */
const PIN = 'pin';
const LIMIT = 200;

export async function load(ctx: WidgetContext): Promise<PinnedWidget> {
	const pinned = ctx.index.findTasks({
		tags: [PIN],
		statuses: OPEN_STATUSES,
		excludePrefixes: [`${config.hubFolder}/`],
		limit: LIMIT
	});

	const items = pinned.map((task) => {
		const owner = workspaceFor(ctx.workspaces, { path: task.path, tags: task.tags });
		return {
			task,
			workspace: owner ? { slug: owner.slug, name: owner.name, color: owner.color } : null
		};
	});

	const scope = ctx.workspace;
	return {
		tag: PIN,
		scope: scope?.name ?? null,
		items: scope ? items.filter((item) => item.workspace?.slug === scope.slug) : items
	};
}

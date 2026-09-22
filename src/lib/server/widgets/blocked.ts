/**
 * The `blocked` widget: cards waiting on another task, and what unblocks them.
 *
 * Deliberately not scoped to one workspace's tasks. SPEC 5.5 asks for
 * cross-workspace visibility: a personal card blocked by a work card shows in
 * both boards, because the work card is the thing that has to move and the
 * person looking at either board needs to see that. So a workspace's lens
 * holds its own blocked cards plus the ones elsewhere that its cards are
 * holding up, each labelled with the workspace it really belongs to.
 */

import { OPEN_STATUSES, type Task } from '../../shared/task';
import { config } from '../config';
import { workspaceFor, type Workspace } from '../workspaces';
import type { WidgetContext } from '../widgets';

export interface WorkspaceLabel {
	slug: string;
	name: string;
	color: string;
}

export interface BlockedItem {
	task: Task;
	workspace: WorkspaceLabel | null;
	/** False when the card belongs to another workspace and ours blocks it. */
	mine: boolean;
	blockers: Array<{ id: string; task: Task | null; workspace: WorkspaceLabel | null }>;
}

export interface BlockedWidget {
	items: BlockedItem[];
	/** Name of the workspace this is scoped to, or null for the whole vault. */
	scope: string | null;
}

const LIMIT = 300;

export async function load(ctx: WidgetContext): Promise<BlockedWidget> {
	return { scope: ctx.workspace?.name ?? null, items: waitingItems(ctx) };
}

/** The tab count: the same items the widget lists, counted rather than rendered. */
export async function count(ctx: WidgetContext): Promise<number> {
	return waitingItems(ctx).length;
}

/**
 * The one query behind both `load` and `count`, so a widget and its tab's
 * pill can never disagree about what is waiting.
 */
function waitingItems(ctx: WidgetContext): BlockedItem[] {
	const waiting = ctx.index.findTasks({
		blocked: true,
		statuses: OPEN_STATUSES,
		excludePrefixes: [`${config.hubFolder}/`],
		excludeDailyNotes: true,
		limit: LIMIT
	});

	const blockers = new Map(
		ctx.index
			.tasksByIds([...new Set(waiting.flatMap((task) => task.blockedBy))])
			.flatMap((task) => (task.id ? [[task.id, task] as const] : []))
	);

	const items = waiting.map((task) => {
		const owner = owningWorkspace(ctx.workspaces, task);
		return {
			task,
			workspace: label(owner),
			mine: ctx.workspace === null || owner?.slug === ctx.workspace.slug,
			blockers: task.blockedBy.map((id) => {
				const blocker = blockers.get(id) ?? null;
				return { id, task: blocker, workspace: blocker ? label(owningWorkspace(ctx.workspaces, blocker)) : null };
			})
		};
	});

	const scope = ctx.workspace;
	return scope
		? items.filter((item) => item.mine || item.blockers.some((b) => b.workspace?.slug === scope.slug))
		: items;
}

function owningWorkspace(workspaces: Workspace[], task: Task): Workspace | null {
	return workspaceFor(workspaces, { path: task.path, tags: task.tags });
}

function label(workspace: Workspace | null): WorkspaceLabel | null {
	return workspace ? { slug: workspace.slug, name: workspace.name, color: workspace.color } : null;
}

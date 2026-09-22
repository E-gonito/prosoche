/**
 * The `people` widget: who this workspace is about, and who is waiting on you.
 *
 * Scoped to the workspace by its folders, its tag and its slug, so a person
 * belongs to a workspace when their note or any note mentioning them sits in
 * it. Not scoped by the workspace tag on a task: no task line in the real vault
 * carries one, so that would empty the widget everywhere.
 */

import { PEOPLE_FOLDER, listPeople } from '../people';
import type { WidgetContext } from '../widgets';

/** Reads the people notes. Writes nothing; the log action does that. */
export async function load(ctx: WidgetContext): Promise<unknown> {
	const workspace = ctx.workspace;
	const people = await listPeople(ctx.vault, ctx.index, scopeFor(workspace));
	return {
		people,
		today: ctx.today,
		folder: PEOPLE_FOLDER,
		scope: workspace?.name ?? null
	};
}

/** The tab count: how many people are in scope, the same rule `load` uses. */
export async function count(ctx: WidgetContext): Promise<number> {
	return (await listPeople(ctx.vault, ctx.index, scopeFor(ctx.workspace))).length;
}

function scopeFor(workspace: WidgetContext['workspace']) {
	return workspace ? { folders: workspace.folders, tags: [workspace.tag], slug: workspace.slug } : {};
}

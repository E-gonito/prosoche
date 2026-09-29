import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { customPages, notebookPaths } from '$server/meetings';
import type { LayoutServerLoad } from './$types';

/**
 * The notebook's frame: which workspace, where it keeps its files, and the
 * custom pages that get a tab each. A workspace with no folder still gets a
 * page, which says why there is nothing in it. A workspace that has not opted
 * in to meetings has no notebook at all, and the 404 says how to give it one.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === params.slug);
	if (!workspace) error(404, 'No such workspace');
	if (!workspace.meetings) {
		error(404, `${workspace.name} has no meetings. Add "meetings: true" to ${workspace.path} to give it a notebook.`);
	}
	const paths = notebookPaths(workspace);
	return {
		workspace: { slug: workspace.slug, name: workspace.name, color: workspace.color },
		home: paths?.home ?? null,
		pages: await customPages(vault, workspace)
	};
};

import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { customPages, notebookPaths } from '$server/meetings';
import type { LayoutServerLoad } from './$types';

/**
 * The notebook's frame: which workspace, where it keeps its files, and the
 * custom pages that get a tab each. A workspace with no folder still gets a
 * page, which says why there is nothing in it.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === params.slug);
	if (!workspace) error(404, 'No such workspace');
	const paths = notebookPaths(workspace);
	return {
		workspace: { slug: workspace.slug, name: workspace.name, color: workspace.color },
		home: paths?.home ?? null,
		pages: await customPages(vault, workspace)
	};
};

import { hub } from '$server/hub';
import { buildBoard } from '$server/board';
import type { BoardWidget } from '$lib/shared/board';
import type { PageServerLoad } from './$types';

/** The workspace's board: the same figures the widget catalogue used to show. */
export const load: PageServerLoad = async ({ params }) => {
	const { index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const workspace = defs.find((w) => w.slug === params.slug)!;

	const board: BoardWidget = {
		workspace: { slug: workspace.slug, name: workspace.name },
		...buildBoard(index, workspace, defs)
	};

	return { board };
};

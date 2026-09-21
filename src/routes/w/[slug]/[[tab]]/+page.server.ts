import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { loadWidgets } from '$server/widgets';
import { slugify } from '$lib/shared/slug';
import type { PageServerLoad } from './$types';

/**
 * A workspace tab.
 *
 * The page is a renderer: the workspace file says which widgets a tab holds,
 * and every widget loads itself. So this load function does three things and
 * no more — find the workspace, pick the tab, load that tab's widgets — and
 * knows nothing about what any widget contains.
 *
 * An unknown slug is a 404. The rail beside it still lists the workspaces
 * that do exist, which is the way back.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const workspace = defs.find((w) => w.slug === params.slug);
	if (!workspace) error(404, `There is no workspace called "${params.slug}".`);

	// A workspace file with no tabs still gets a board, rather than a blank
	// page that gives the user nothing to act on.
	const tabs = (workspace.tabs.length ? workspace.tabs : [{ title: 'Board', widgets: ['board'] }]).map((tab) => ({
		title: tab.title,
		slug: slugify(tab.title),
		widgets: tab.widgets
	}));
	const tab = (params.tab ? tabs.find((t) => t.slug === params.tab) : tabs[0]) ?? tabs[0];
	if (params.tab && !tabs.some((t) => t.slug === params.tab)) {
		error(404, `${workspace.name} has no "${params.tab}" tab.`);
	}

	return {
		workspace: {
			slug: workspace.slug,
			name: workspace.name,
			color: workspace.color,
			tag: workspace.tag,
			folders: workspace.folders,
			deck: workspace.deck
		},
		/** The workspace file itself, so tabs are edited as markdown. */
		definition: `/notes/${workspace.path.split('/').map(encodeURIComponent).join('/')}`,
		tabs: tabs.map(({ title, slug }) => ({ title, slug })),
		tab: tab.slug,
		widgets: await loadWidgets(tab.widgets, {
			index,
			vault,
			workspace,
			workspaces: defs,
			today: today()
		})
	};
};

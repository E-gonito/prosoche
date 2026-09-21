import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

/**
 * What the new-workspace wizard needs to fill itself in: the names already
 * taken, so a clash is shown in the form, and the choices on offer.
 *
 * The template descriptions mirror the tab lists in `$server/workspaces`. They
 * are written here rather than read from there because that module does not
 * export them; if a template gains a tab, this line should be updated with it.
 */
export const load: PageServerLoad = async () => {
	const { ready, workspaces } = hub();
	await ready;

	return {
		existing: (await workspaces()).map((w) => ({ slug: w.slug, name: w.name })),
		colors: ['#2f6fed', '#7c3aed', '#16a34a', '#ea580c', '#d9534f', '#0891b2', '#6b7280'],
		templates: [
			{ name: 'project', title: 'Project', tabs: 'Board, Notes, People, Blocked, Time, Insights' },
			{ name: 'business', title: 'Business', tabs: 'Board, Notes, People, Blocked, Insights' },
			{ name: 'study', title: 'Study', tabs: 'Overview, Board, Notes, Insights' },
			{ name: 'area', title: 'Area of life', tabs: 'Dashboard, Board, Notes, Insights' }
		]
	};
};

import { hub } from '$server/hub';
import { listPeople } from '$server/people';
import { listDeals } from '$server/deals';
import type { PageServerLoad } from './$types';

/**
 * A workspace's CRM: the people its notes mention, and its deal pipeline.
 *
 * People are found the one way `people.ts` finds anyone: a note under the
 * people folder, or mentioned by a note inside this workspace's scope.
 * Deals are `<home>/Deals.md`, read by `parse/deal.ts`.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const workspace = (await workspaces()).find((w) => w.slug === params.slug)!;
	const people = await listPeople(vault, index, {
		folders: workspace.folders,
		tags: [workspace.tag],
		slug: workspace.slug
	});
	const deals = await listDeals(vault, workspace);

	return {
		people: people.map((p) => ({ ...p, href: `/people/${encodeURIComponent(p.name)}` })),
		deals,
		stages: workspace.stages
	};
};

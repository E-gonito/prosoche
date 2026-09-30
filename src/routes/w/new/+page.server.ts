import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

/**
 * What the new-workspace wizard needs: the names already taken, so a clash is
 * shown in the form, and the colour choices on offer.
 */
export const load: PageServerLoad = async () => {
	const { workspaces } = await hub();

	return {
		existing: (await workspaces()).map((w) => ({ slug: w.slug, name: w.name })),
		colors: ['#2f6fed', '#7c3aed', '#16a34a', '#ea580c', '#d9534f', '#0891b2', '#6b7280']
	};
};

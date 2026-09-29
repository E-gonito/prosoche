import { hub } from '$server/hub';
import type { LayoutServerLoad } from './$types';

/**
 * The workspaces, on every page, because the rail lists them under
 * Workspaces. Name, colour and slug only: the rail is a way in, not a report.
 */
export const load: LayoutServerLoad = async () => {
	const { ready, workspaces } = hub();
	await ready;
	return {
		workspaces: (await workspaces()).map((w) => ({ slug: w.slug, name: w.name, color: w.color }))
	};
};

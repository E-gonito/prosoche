import { hub } from '$server/hub';
import { listGlossaries } from '$server/glossary';
import type { PageServerLoad } from './$types';

/**
 * Every workspace with its glossary: those that have one, with their size,
 * and those that could start one. A workspace with no folder has nowhere to
 * keep a glossary and is left out.
 */
export const load: PageServerLoad = async () => {
	const { vault, ready, workspaces } = hub();
	await ready;
	const all = (await listGlossaries(vault, await workspaces())).filter((g) => g.path !== null);
	return {
		glossaries: all.filter((g) => g.exists),
		unstarted: all.filter((g) => !g.exists)
	};
};

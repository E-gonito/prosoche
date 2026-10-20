import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { loadLibrary, viewOf } from '$server/tactics';
import type { PageServerLoad } from './$types';

/**
 * One scenario, answer and Why included, to review and approve. A scenario
 * that does not read is shown with its problems instead; an id in neither
 * list is a 404.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index } = await hub();
	const { scenarios, problems } = await loadLibrary(vault);
	const scenario = scenarios.find((s) => s.id === params.id);
	if (scenario) return { scenario: viewOf(scenario, index), problem: null };
	const problem = problems.find((p) => p.id === params.id);
	if (problem) return { scenario: null, problem };
	error(404, 'There is no scenario with that id.');
};

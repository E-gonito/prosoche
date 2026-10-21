import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { readGraph } from '$server/graph/graphs';
import type { LayoutServerLoad } from './$types';

/**
 * Which graph every page under `/graph/<slug>` is about, and its analysis,
 * read once here so the Insights and Explorer tabs need no load of their own.
 * An unknown slug is a 404; a graph with no `graph.json` loads, with a
 * reason, so the page can say how to fix it.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { vault, graphs } = await hub();
	const graph = (await graphs()).find((g) => g.slug === params.slug);
	if (!graph) error(404, 'There is no such graph.');
	return { graph, read: await readGraph(vault, graph) };
};

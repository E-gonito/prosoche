import { hub } from '$server/hub';
import { readGraph } from '$server/graph/graphs';
import type { PageServerLoad } from './$types';

/** Every graph in `_hub/graphs/`, with its size, or none when its `graph.json` is not there yet. */
export const load: PageServerLoad = async () => {
	const { vault, graphs } = await hub();
	const rows = [];
	for (const g of await graphs()) {
		const read = await readGraph(vault, g);
		rows.push({ ...g, stats: read.ok ? { nodes: read.insights.nodes, edges: read.insights.edges, communities: read.insights.communities } : null });
	}
	return { graphs: rows };
};

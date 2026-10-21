/**
 * Graphs: what the Graph section is divided into.
 *
 * A graph is one markdown file in `_hub/graphs/`, the way a subject is one in
 * `_hub/subjects/`, and any number can exist. The file names it, colours it
 * and says which folder it was made from; the data sits beside it, in a
 * folder of the same name, as `graphify` wrote it:
 *
 *     _hub/graphs/computer-science.md              the definition
 *     _hub/graphs/computer-science/graph.json      required: the data
 *     _hub/graphs/computer-science/graph.html      optional: the interactive map
 *
 *     ---
 *     name: Computer Science
 *     color: "#2e6b85"
 *     source: Computer Science
 *     ---
 *
 * Prosoche only reads these. graphify is run by hand, on the folder, and its
 * two files are copied in; nothing here runs a model or writes the vault.
 * `loadGraphs` and `readGraph` are the one place that knows this layout.
 */

import { config } from '../config';
import { parseNote, readLede } from '../parse/note';
import { analyse } from './insights';
import type { GraphInsights, GraphRef } from '$lib/shared/graph';
import type { Vault } from '../vault/index';

const GRAPH_DIR = `${config.hubFolder}/graphs`;

/** A graph, with where its files are. */
export interface Graph extends GraphRef {
	description: string;
	/** The folder of notes it was made from, for display; may be empty. */
	source: string;
	/** Its definition file. */
	path: string;
	/** Where `graph.json` and `graph.html` are looked for. */
	dir: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Every graph, in file-name order. Never throws; a vault with none has none. */
export async function loadGraphs(vault: Vault): Promise<Graph[]> {
	const paths = (await vault.list()).filter((p) => p.startsWith(`${GRAPH_DIR}/`) && !p.slice(GRAPH_DIR.length + 1).includes('/')).sort();
	const graphs: Graph[] = [];
	for (const path of paths) {
		const note = await vault.read(path);
		if (!note.exists) continue;
		const fm = parseNote(note.content, path).frontmatter;
		const slug = (path.split('/').pop() ?? '').replace(/\.md$/, '');
		graphs.push({
			slug,
			name: str(fm.name) ?? slug,
			color: str(fm.color) ?? '#6b7280',
			description: readLede(note.content),
			source: str(fm.source) ?? '',
			path,
			dir: `${GRAPH_DIR}/${slug}`
		});
	}
	return graphs;
}

/** A graph's analysis, or why there is none. */
export type GraphRead = { ok: true; insights: GraphInsights; hasMap: boolean } | { ok: false; reason: 'missing' | 'unreadable' };

/** Analysis by content hash: `graph.json` is over a megabyte, and changes only when re-run. */
const analysed = new Map<string, GraphInsights>();

/**
 * Read and analyse a graph's `graph.json`. A missing file is `missing`, and a
 * file that is not JSON is `unreadable`; neither throws. Never writes.
 */
export async function readGraph(vault: Vault, graph: Graph): Promise<GraphRead> {
	const note = await vault.read(`${graph.dir}/graph.json`);
	if (!note.exists) return { ok: false, reason: 'missing' };
	let insights = analysed.get(note.hash);
	if (!insights) {
		try {
			insights = analyse(JSON.parse(note.content));
		} catch {
			return { ok: false, reason: 'unreadable' };
		}
		analysed.clear();
		analysed.set(note.hash, insights);
	}
	return { ok: true, insights, hasMap: (await vault.files(graph.dir, 'html')).includes('graph.html') };
}

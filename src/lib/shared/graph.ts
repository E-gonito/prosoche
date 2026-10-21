/**
 * The vocabulary of the Graph section: a graph, and what is said about it.
 *
 * A graph is the output of `graphify` run over a folder of notes. These shapes
 * are the contract between `server/graph/insights.ts`, which reads the raw
 * `graph.json` and works out what it means, and the screens that show the
 * result. They live in `shared/` because both sides need them and neither
 * may import the other.
 */

/** One graph, as the rail and the list need it. */
export interface GraphRef {
	/** The definition file's name, and the `/graph/<slug>` segment. */
	slug: string;
	name: string;
	color: string;
}

/** A node worth naming: a label, where its note is, and how connected it is. */
export interface NodeRef {
	label: string;
	/** Vault-relative path of the note it came from, relative to the graphed folder. */
	file: string;
	community: string;
	degree: number;
}

export interface CommunityStat {
	id: number;
	name: string;
	size: number;
	/** Share of the edges touching this community that stay inside it, 0 to 1. */
	cohesion: number;
	/** Its best-connected nodes. */
	top: string[];
}

/** A link between two communities the extractor inferred, not read off the page. */
export interface Surprise {
	from: string;
	to: string;
	relation: string;
	confidence: number;
	fromCommunity: string;
	toCommunity: string;
}

export interface FolderStat {
	folder: string;
	nodes: number;
	/** Share of its edges that leave the folder, 0 to 1. */
	reach: number;
}

export interface Tip {
	title: string;
	body: string;
}

/** Everything the Insights tab shows. */
export interface GraphInsights {
	nodes: number;
	edges: number;
	communities: number;
	/** Edge counts by how sure the extractor was. */
	confidence: { extracted: number; inferred: number; ambiguous: number };
	/** Node counts by kind: concept, document, code, image... */
	kinds: Array<{ kind: string; count: number }>;
	godNodes: NodeRef[];
	/** Nodes that join the most different communities. */
	bridges: Array<NodeRef & { reaches: number }>;
	communityStats: CommunityStat[];
	/** Communities of three or fewer nodes: ideas that never joined anything. */
	islands: CommunityStat[];
	surprises: Surprise[];
	/** Edges the extractor could not decide on; worth checking by hand. */
	ambiguous: Surprise[];
	folders: FolderStat[];
	/** Nodes with at most one link. */
	looseEnds: number;
	tips: Tip[];
}

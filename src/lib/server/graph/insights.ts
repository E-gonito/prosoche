/**
 * What a graphify `graph.json` says, worked out.
 *
 * `analyse` takes the parsed file and returns the numbers and the plain-
 * language advice the Insights tab shows. Pure: no filesystem, no clock, and
 * a malformed file reads as an empty graph rather than throwing, since the
 * file is machine-written but is also copied about by hand.
 *
 * The advice is rules over the numbers, not a model's opinion: each tip
 * fires on a threshold and says which number tripped it, so it can be checked.
 */

import type { CommunityStat, FolderStat, GraphInsights, NodeRef, Surprise, Tip } from '$lib/shared/graph';

interface RawNode {
	id: string;
	label?: string;
	community?: number;
	community_name?: string;
	file_type?: string;
	source_file?: string;
}

interface RawLink {
	source: string;
	target: string;
	relation?: string;
	confidence?: string;
	confidence_score?: number;
}

const GOD_NODES = 10;
const BRIDGES = 8;
const SURPRISES = 8;
const ISLAND_SIZE = 3;

const folderOf = (file: string | undefined) => (file ?? '').split('/')[0] || '(root)';
const rest = (file: string | undefined) => (file ?? '').split('/').slice(1).join('/') || (file ?? '');
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function analyse(raw: unknown): GraphInsights {
	const data = (raw ?? {}) as { nodes?: RawNode[]; links?: RawLink[]; edges?: RawLink[] };
	const nodes = Array.isArray(data.nodes) ? data.nodes : [];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	// Edges naming a node that is not there are dropped, not counted.
	const links = (data.links ?? data.edges ?? []).filter((l) => byId.has(l.source) && byId.has(l.target));

	const degree = new Map<string, number>();
	const neighbours = new Map<string, Set<string>>();
	for (const l of links) {
		for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) {
			degree.set(a, (degree.get(a) ?? 0) + 1);
			(neighbours.get(a) ?? neighbours.set(a, new Set()).get(a)!).add(b);
		}
	}
	const deg = (id: string) => degree.get(id) ?? 0;
	const communityName = (n: RawNode) => n.community_name ?? `Community ${n.community ?? '?'}`;
	const ref = (n: RawNode): NodeRef => ({ label: n.label ?? n.id, file: rest(n.source_file), community: communityName(n), degree: deg(n.id) });

	const confidence = { extracted: 0, inferred: 0, ambiguous: 0 };
	for (const l of links) {
		if (l.confidence === 'INFERRED') confidence.inferred++;
		else if (l.confidence === 'AMBIGUOUS') confidence.ambiguous++;
		else confidence.extracted++;
	}

	const kindCounts = new Map<string, number>();
	for (const n of nodes) kindCounts.set(n.file_type ?? 'other', (kindCounts.get(n.file_type ?? 'other') ?? 0) + 1);

	const byDegree = [...nodes].sort((a, b) => deg(b.id) - deg(a.id));

	// Bridges: nodes whose neighbours sit in the most communities other than their own.
	const bridges = nodes
		.map((n) => {
			const others = new Set<number | undefined>();
			for (const m of neighbours.get(n.id) ?? []) if (byId.get(m)!.community !== n.community) others.add(byId.get(m)!.community);
			return { n, reaches: others.size };
		})
		.filter((b) => b.reaches >= 2)
		.sort((a, b) => b.reaches - a.reaches || deg(b.n.id) - deg(a.n.id))
		.slice(0, BRIDGES)
		.map((b) => ({ ...ref(b.n), reaches: b.reaches }));

	// Communities.
	const groups = new Map<number, RawNode[]>();
	for (const n of nodes) (groups.get(n.community ?? -1) ?? groups.set(n.community ?? -1, []).get(n.community ?? -1)!).push(n);
	const inside = new Map<number, number>();
	const touching = new Map<number, number>();
	for (const l of links) {
		const a = byId.get(l.source)!.community ?? -1;
		const b = byId.get(l.target)!.community ?? -1;
		touching.set(a, (touching.get(a) ?? 0) + 1);
		if (a === b) inside.set(a, (inside.get(a) ?? 0) + 1);
		else touching.set(b, (touching.get(b) ?? 0) + 1);
	}
	const communityStats: CommunityStat[] = [...groups.entries()]
		.map(([id, members]) => ({
			id,
			name: communityName(members[0]),
			size: members.length,
			cohesion: touching.get(id) ? (inside.get(id) ?? 0) / touching.get(id)! : 0,
			top: [...members].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, 3).map((m) => m.label ?? m.id)
		}))
		.sort((a, b) => b.size - a.size);
	const islands = communityStats.filter((c) => c.size <= ISLAND_SIZE);

	// Cross-community links.
	const surprise = (l: RawLink): Surprise => {
		const a = byId.get(l.source)!;
		const b = byId.get(l.target)!;
		return { from: a.label ?? a.id, to: b.label ?? b.id, relation: (l.relation ?? 'related').replace(/_/g, ' '), confidence: l.confidence_score ?? 0, fromCommunity: communityName(a), toCommunity: communityName(b) };
	};
	const crossing = (l: RawLink) => byId.get(l.source)!.community !== byId.get(l.target)!.community;
	const surprises = links
		.filter((l) => l.confidence === 'INFERRED' && crossing(l))
		.sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
		.slice(0, SURPRISES)
		.map(surprise);
	const ambiguous = links.filter((l) => l.confidence === 'AMBIGUOUS').map(surprise);

	// Folders: how much each top-level folder links out to the others.
	const folderNodes = new Map<string, number>();
	const folderEdges = new Map<string, { all: number; out: number }>();
	for (const n of nodes) folderNodes.set(folderOf(n.source_file), (folderNodes.get(folderOf(n.source_file)) ?? 0) + 1);
	for (const l of links) {
		const a = folderOf(byId.get(l.source)!.source_file);
		const b = folderOf(byId.get(l.target)!.source_file);
		for (const f of a === b ? [a] : [a, b]) {
			const e = folderEdges.get(f) ?? folderEdges.set(f, { all: 0, out: 0 }).get(f)!;
			e.all++;
			if (a !== b) e.out++;
		}
	}
	const folders: FolderStat[] = [...folderNodes.entries()]
		.map(([folder, count]) => ({ folder, nodes: count, reach: folderEdges.get(folder)?.all ? folderEdges.get(folder)!.out / folderEdges.get(folder)!.all : 0 }))
		.sort((a, b) => b.nodes - a.nodes);

	const looseEnds = nodes.filter((n) => deg(n.id) <= 1).length;

	const insights: GraphInsights = {
		nodes: nodes.length,
		edges: links.length,
		communities: groups.size,
		confidence,
		kinds: [...kindCounts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
		godNodes: byDegree.slice(0, GOD_NODES).map(ref),
		bridges,
		communityStats,
		islands,
		surprises,
		ambiguous,
		folders,
		looseEnds,
		tips: []
	};
	insights.tips = tipsFor(insights);
	return insights;
}

/** Advice for the numbers: each tip names the number that triggered it. Pure. */
export function tipsFor(g: GraphInsights): Tip[] {
	if (!g.nodes) return [];
	const tips: Tip[] = [];
	const top = g.godNodes[0];
	if (top) {
		tips.push({
			title: 'Start from your hubs',
			body: `"${top.label}" has ${top.degree} links, the most in the graph. Hubs are where a topic is organised, so they are the best places to open a revision session and the notes most worth keeping tidy. Read the top ten in the Hubs table below, in order: together they are a table of contents for what you actually wrote.`
		});
	}
	if (g.bridges.length) {
		const b = g.bridges[0];
		tips.push({
			title: 'Study the bridges to join topics up',
			body: `"${b.label}" touches ${b.reaches} other communities. A bridge is an idea that makes two subjects talk to each other, which is what interviews and projects tend to ask for. When a topic feels isolated, find the bridge nearest to it and revise that first.`
		});
	}
	const loose = g.looseEnds / g.nodes;
	if (loose > 0.25) {
		tips.push({
			title: 'Link your loose ends',
			body: `${g.looseEnds} of ${g.nodes} nodes (${pct(loose)}) have one link or none. These are ideas you noted once and never connected. Pick a note, add a [[wikilink]] from it to a hub it belongs under, and re-run graphify: the graph rewards linking, not collecting.`
		});
	}
	if (g.islands.length) {
		tips.push({
			title: `${g.islands.length} small island${g.islands.length === 1 ? '' : 's'} to fold in or finish`,
			body: `Communities of ${g.islands.length === 1 ? 'a few nodes' : 'three nodes or fewer'}, such as "${g.islands[0].name}", did not attach to anything bigger. Either they are one-off notes that belong in a larger topic, or they are the start of a topic you have not gone back to. Decide which, then move or expand them.`
		});
	}
	const scattered = g.communityStats.filter((c) => c.size >= 8 && c.cohesion < 0.7);
	if (scattered.length) {
		tips.push({
			title: 'Loosely held topics are where revision pays off',
			body: `${scattered.slice(0, 3).map((c) => `"${c.name}"`).join(', ')} ${scattered.length === 1 ? 'is' : 'are'} big but only ${pct(scattered[0].cohesion)} or so of ${scattered.length === 1 ? 'its' : 'their'} links stay inside. Their ideas lean on other topics, so a summary note that states how they fit together would help more than reading further.`
		});
	}
	const silo = g.folders.filter((f) => f.nodes >= 10 && f.reach < 0.15);
	if (silo.length) {
		tips.push({
			title: 'Folders that never talk to the rest',
			body: `${silo.slice(0, 4).map((f) => `${f.folder} (${pct(f.reach)} of links leave it)`).join(', ')}. A folder walled off like this is either genuinely separate or a place where cross-references are missing. If you want it to help with other subjects, write one note linking it to a neighbour.`
		});
	}
	if (g.surprises.length) {
		tips.push({
			title: 'Check the surprising connections, then keep the good ones',
			body: `${g.confidence.inferred} links were inferred by the model, not found in your text. Read the ones below: each real one is a free insight to write down as a note, and a wrong one tells you the extractor misread something.`
		});
	}
	if (g.ambiguous.length) {
		tips.push({
			title: `${g.ambiguous.length} ambiguous link${g.ambiguous.length === 1 ? '' : 's'} need a human`,
			body: 'The extractor could not decide on these. Open the two notes in each pair and either link or separate them yourself, which also corrects the next run.'
		});
	}
	tips.push({
		title: 'Re-run it as you write',
		body: 'The graph is a snapshot. After a week of new notes, re-run graphify on the folder and replace this graph\'s files: growing hubs and shrinking islands are the clearest sign your notes are consolidating.'
	});
	return tips;
}

<script lang="ts">
	/**
	 * What a graph says about the notes behind it: the headline numbers, advice
	 * for using it, the notes everything hangs off, the ideas that join topics,
	 * the topics themselves, and the links worth a second look. All of it is
	 * worked out from `graph.json` in `server/graph/insights.ts`; this page only
	 * lays it out.
	 */
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
	const read = $derived(data.read);
	const pct = (n: number) => `${Math.round(n * 100)}%`;
	const widest = $derived(read.ok ? Math.max(1, ...read.insights.communityStats.map((c) => c.size)) : 1);
</script>

<svelte:head><title>{data.graph.name} · Graph · prosoche</title></svelte:head>

{#if !read.ok}
	<p class="empty" data-testid="graph-missing">
		{#if read.reason === 'missing'}
			No <code>graph.json</code> in <code>{data.graph.dir}/</code> yet. Run graphify on {data.graph.source ? `“${data.graph.source}”` : 'the folder'} and copy its
			<code>graph.json</code> there.
		{:else}
			<code>{data.graph.dir}/graph.json</code> is not valid JSON. Run graphify again and replace it.
		{/if}
	</p>
{:else}
	{@const g = read.insights}
	<div class="stats" data-testid="graph-stats">
		<div class="stat"><b class="num">{g.nodes}</b><span>nodes</span></div>
		<div class="stat"><b class="num">{g.edges}</b><span>links</span></div>
		<div class="stat"><b class="num">{g.communities}</b><span>communities</span></div>
		<div class="stat"><b class="num">{pct(g.edges ? g.confidence.extracted / g.edges : 0)}</b><span>read off your text</span></div>
		<div class="stat"><b class="num">{pct(g.nodes ? g.looseEnds / g.nodes : 0)}</b><span>loose ends</span></div>
	</div>

	<p class="label">How to use this graph</p>
	<div class="sheet tips" data-testid="graph-tips">
		{#each g.tips as tip (tip.title)}
			<div class="tip">
				<h3>{tip.title}</h3>
				<p>{tip.body}</p>
			</div>
		{/each}
	</div>

	<p class="label">Hubs <span class="right">the notes everything hangs off</span></p>
	<div class="sheet rows" data-testid="graph-hubs">
		{#each g.godNodes as n, i (n.label + n.file)}
			<div class="row">
				<span class="rank num muted">{i + 1}</span>
				<span class="grow"><b>{n.label}</b> <span class="muted small">{n.community}</span></span>
				{#if n.file}<a class="small muted file" href={noteHref(`${data.graph.source ? `${data.graph.source}/` : ''}${n.file}`)}>{n.file}</a>{/if}
				<span class="badge muted num">{n.degree} links</span>
			</div>
		{/each}
	</div>

	{#if g.bridges.length}
		<p class="label">Bridges <span class="right">ideas that join different topics</span></p>
		<div class="sheet rows" data-testid="graph-bridges">
			{#each g.bridges as n (n.label + n.file)}
				<div class="row">
					<span class="grow"><b>{n.label}</b> <span class="muted small">in {n.community}</span></span>
					<span class="badge muted num">reaches {n.reaches} other topics</span>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">Topics <span class="right">cohesion: how much of a topic's linking stays inside it</span></p>
	<div class="sheet rows" data-testid="graph-communities">
		{#each g.communityStats as c (c.id)}
			<div class="row topic">
				<span class="grow">
					<b>{c.name}</b>
					<span class="muted small">{c.top.join(' · ')}</span>
				</span>
				<span class="bar" title="{c.size} nodes"><i style="width: {(c.size / widest) * 100}%"></i></span>
				<span class="num small muted size">{c.size}</span>
				<span class="badge muted num" title="Links that stay inside this topic">{pct(c.cohesion)}</span>
			</div>
		{/each}
	</div>

	{#if g.surprises.length}
		<p class="label">Surprising connections <span class="right">inferred, across topics, strongest first</span></p>
		<div class="sheet rows" data-testid="graph-surprises">
			{#each g.surprises as s (s.from + s.to + s.relation)}
				<div class="row link">
					<span class="grow"><b>{s.from}</b> <span class="muted">{s.relation}</span> <b>{s.to}</b></span>
					<span class="muted small">{s.fromCommunity} → {s.toCommunity}</span>
					<span class="badge muted num">{s.confidence.toFixed(2)}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if g.ambiguous.length}
		<p class="label">Needs a human <span class="right">the extractor could not decide</span></p>
		<div class="sheet rows" data-testid="graph-ambiguous">
			{#each g.ambiguous as s (s.from + s.to)}
				<div class="row link">
					<span class="grow"><b>{s.from}</b> <span class="muted">{s.relation}</span> <b>{s.to}</b></span>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">Folders <span class="right">share of each folder's links that leave it</span></p>
	<div class="sheet rows" data-testid="graph-folders">
		{#each g.folders as f (f.folder)}
			<div class="row">
				<span class="grow"><b>{f.folder}</b></span>
				<span class="bar"><i style="width: {f.reach * 100}%"></i></span>
				<span class="num small muted size">{f.nodes}</span>
				<span class="badge muted num">{pct(f.reach)}</span>
			</div>
		{/each}
	</div>

	<p class="muted small kinds">
		{#each g.kinds as k, i (k.kind)}{i ? ' · ' : ''}{k.count} {k.kind}{/each}
	</p>
{/if}

<style>
	.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--s3); margin-bottom: var(--s4); }
	.stat { display: flex; flex-direction: column; padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); }
	.stat b { font: 600 var(--t24)/1.1 var(--serif); }
	.stat span { color: var(--muted); font-size: var(--t13); }

	.tips { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--s4); }
	.tip h3 { margin: 0 0 var(--s1); font: 600 var(--t16) var(--serif); }
	.tip p { margin: 0; font-size: var(--t14); line-height: 1.5; color: var(--text); }

	.row { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) 0; border-top: 1px solid var(--line); font-size: var(--t14); }
	.row:first-child { border-top: 0; }
	.grow { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px var(--s2); }
	.rank { width: 1.5em; text-align: right; flex: none; }
	.file { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bar { flex: none; width: 90px; height: 6px; border-radius: var(--r-pill); background: var(--soft); overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.size { flex: none; width: 3ch; text-align: right; }
	.topic .grow { flex-direction: column; align-items: flex-start; gap: 0; }
	.link .small { flex: none; }
	.kinds { margin-top: var(--s4); }
	@media (max-width: 640px) {
		.bar, .file { display: none; }
	}
</style>

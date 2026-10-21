<script lang="ts">
	/**
	 * Every graph, one row each. A graph is made outside prosoche by running
	 * graphify on a folder of notes; this page lists what has been copied into
	 * `_hub/graphs/` and says how to add another.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
</script>

<svelte:head><title>Graph · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Graph</h1>
		<p>What your notes connect to, one graph per topic</p>
	</div>

	<div class="sheet rows" data-testid="graphs">
		{#each data.graphs as g (g.slug)}
			<div class="line" data-testid="graph-row">
				<a class="graph" href="/graph/{g.slug}">
					<i class="dot" style="--dot: {g.color}"></i>
					<span class="main">
						<span class="name">{g.name}</span>
						{#if g.description}<span class="muted small desc">{g.description}</span>{/if}
					</span>
					<span class="muted small">
						{#if g.stats}{g.stats.nodes} nodes · {g.stats.communities} communities{:else}no graph.json yet{/if}
					</span>
					<Icon name="chevron-right" />
				</a>
				<a class="muted small" href={noteHref(g.path)}>Edit</a>
			</div>
		{:else}
			<p class="empty">No graph yet. How to add one is below.</p>
		{/each}
	</div>

	<p class="label">Add a graph</p>
	<ol class="how small">
		<li>Run <code>/graphify</code> on a folder of your notes, such as <code>Computer Science</code>.</li>
		<li>
			Copy the two files it writes into the vault, in a folder named for the graph:
			<code>_hub/graphs/&lt;name&gt;/graph.json</code> and <code>graph.html</code>.
		</li>
		<li>
			Beside that folder add <code>_hub/graphs/&lt;name&gt;.md</code> with a <code>name:</code>, a <code>color:</code> and a
			<code>source:</code> (the folder you graphed). It then appears here and in the rail.
		</li>
	</ol>
</div>

<style>
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); }
	.graph { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--text); }
	.main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	a.graph:hover { text-decoration: none; }
	a.graph:hover .name { color: var(--accent); }
	.graph .name { font-weight: 500; }
	.graph > .muted { margin-left: auto; text-align: right; flex: none; }
	.graph :global(svg) { color: var(--muted); flex: none; }
	.how { margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: var(--s2); line-height: 1.5; }
</style>

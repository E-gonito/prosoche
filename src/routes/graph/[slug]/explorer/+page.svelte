<script lang="ts">
	/**
	 * graphify's own interactive map, embedded from the vault.
	 *
	 * `allow-scripts` and nothing else, as for a workspace's custom pages: the
	 * map runs its own script but can never read this origin's cookies or
	 * storage. It loads its drawing library from a CDN, so it needs internet.
	 */
	let { data } = $props();
	const read = $derived(data.read);
</script>

<svelte:head><title>Explorer · {data.graph.name} · prosoche</title></svelte:head>

{#if read.ok && read.hasMap}
	<iframe class="embed" title="{data.graph.name} graph" src="explorer/raw" sandbox="allow-scripts" data-testid="graph-map"></iframe>
	<p class="muted small">Search a node, click it to see its links, click a legend colour to isolate a community.</p>
{:else}
	<p class="empty">No <code>graph.html</code> in <code>{data.graph.dir}/</code>. Copy it in from graphify's output to explore the map here.</p>
{/if}

<style>
	.embed { display: block; width: 100%; height: 78vh; border: 1px solid var(--line); border-radius: var(--r); background: #0f0f1a; }
</style>

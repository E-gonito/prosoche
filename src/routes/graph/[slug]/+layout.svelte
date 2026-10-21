<script lang="ts">
	/** A graph's heading and its two tabs: Insights, and the interactive Explorer. */
	import { page } from '$app/state';
	import DetailsHeader from '$lib/components/DetailsHeader.svelte';

	let { data, children } = $props();
	const base = $derived(`/graph/${data.graph.slug}`);
	const tabs = $derived([
		{ title: 'Insights', href: base },
		{ title: 'Explorer', href: `${base}/explorer` }
	]);
</script>

<div class="page">
	<DetailsHeader
		crumb={{ href: '/graph', label: 'Graph' }}
		details={{ name: data.graph.name, description: data.graph.description, color: data.graph.color }}
		fallback={data.graph.source ? `Built from the “${data.graph.source}” folder` : ''}
	/>
	<nav class="tabs" data-testid="graph-tabs" aria-label="{data.graph.name} tabs">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.title}</a>
		{/each}
	</nav>
	{@render children()}
</div>

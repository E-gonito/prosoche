<script lang="ts">
	/**
	 * A workspace: its heading, a strip of tabs, and whatever the current one
	 * renders.
	 *
	 * The heading and the tab strip are the things every workspace page
	 * shares, so they live here rather than being redrawn by each. The heading
	 * is the shared `DetailsHeader`; the workspace is edited from the
	 * Workspaces list. Which tabs exist is decided by
	 * the server load in `+layout.server.ts`; this component only draws them
	 * and marks the current one.
	 */
	import { page } from '$app/state';
	import DetailsHeader from '$lib/components/DetailsHeader.svelte';

	let { data, children } = $props();

	const href = (slug: string) => (slug ? `/w/${data.workspace.slug}/${slug}` : `/w/${data.workspace.slug}`);
	const isActive = (slug: string) => page.url.pathname === href(slug);
</script>

<svelte:head><title>{data.workspace.name} · prosoche</title></svelte:head>

<div class="page wide">
	<DetailsHeader details={data.workspace}>
		{#snippet meta()}<code class="tag">#{data.workspace.tag}</code>{/snippet}
	</DetailsHeader>

	<nav class="tabs" aria-label="{data.workspace.name} tabs" data-testid="tabs">
		{#each data.tabs as tab (tab.slug)}
			<a href={href(tab.slug)} aria-current={isActive(tab.slug) ? 'page' : undefined} data-testid="tab">{tab.title}</a>
		{/each}
	</nav>

	{@render children()}
</div>

<style>
	.tag { font: var(--t12) var(--mono); color: var(--muted); }
</style>

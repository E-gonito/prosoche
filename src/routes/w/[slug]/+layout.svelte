<script lang="ts">
	/**
	 * A workspace: its name and tag, a strip of tabs, and whatever the current
	 * one renders.
	 *
	 * The tab strip is the one thing every workspace page shares, so it lives
	 * here rather than being redrawn by each. Which tabs exist is decided by
	 * the server load in `+layout.server.ts`; this component only draws them
	 * and marks the current one.
	 */
	import { page } from '$app/state';
	import WorkspaceDetails from '$lib/components/WorkspaceDetails.svelte';

	let { data, children } = $props();

	/** True while the name, description, colour, tag and kind are being edited. */
	let editing = $state(false);

	const href = (slug: string) => (slug ? `/w/${data.workspace.slug}/${slug}` : `/w/${data.workspace.slug}`);
	const isActive = (slug: string) => page.url.pathname === href(slug);
</script>

<svelte:head><title>{data.workspace.name} · prosoche</title></svelte:head>

<div class="page wide">
	<div class="title">
		<h1><span class="dot lg" style="--dot: {data.workspace.color}"></span>{data.workspace.name}</h1>
		{#if data.workspace.description}<p class="desc" data-testid="workspace-description">{data.workspace.description}</p>{/if}
		<p>
			<code class="tag">#{data.workspace.tag}</code>
			{#if !editing}· <button class="link-btn" onclick={() => (editing = true)} data-testid="edit-workspace">Edit</button>{/if}
		</p>
	</div>

	{#if editing}
		{#key data.workspace.slug}
			<WorkspaceDetails workspace={data.workspace} definitionHref={data.definitionHref} onclose={() => (editing = false)} />
		{/key}
	{/if}

	<nav class="tabs" aria-label="{data.workspace.name} tabs" data-testid="tabs">
		{#each data.tabs as tab (tab.slug)}
			<a href={href(tab.slug)} aria-current={isActive(tab.slug) ? 'page' : undefined} data-testid="tab">{tab.title}</a>
		{/each}
	</nav>

	{@render children()}
</div>

<style>
	h1 { display: flex; align-items: center; gap: var(--s2); }
	.tag { font: var(--t12) var(--mono); color: var(--muted); }
	.desc { margin: var(--s1) 0 0; }
	.link-btn { padding: 0; border: 0; background: none; font: inherit; color: var(--accent); cursor: pointer; }
	.link-btn:hover { text-decoration: underline; }
</style>

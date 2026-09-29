<script lang="ts">
	/**
	 * Every workspace's glossary, and a way to start one for a workspace that
	 * has none. Starting one is the user's own act, so it writes straight away:
	 * a `Glossary.md` holding only its title, which the page then opens.
	 */
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { glossaryAction } from '$lib/client/glossary';

	let { data } = $props();

	let problem = $state('');
	let busy = $state<string | null>(null);

	async function start(slug: string) {
		busy = slug;
		problem = '';
		const result = await glossaryAction({ action: 'start', slug });
		busy = null;
		if (!result.ok) problem = result.message;
		// Invalidates the root layout too, so the rail gains the new glossary.
		else await goto(`/glossary/${slug}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>Glossary · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Glossary</h1>
		<p>The words you had to guess at, one glossary per workspace</p>
	</div>

	<div class="sheet rows" data-testid="glossaries">
		{#each data.glossaries as g (g.slug)}
			<a class="glossary" href="/glossary/{g.slug}">
				<i style="--dot: {g.color}"></i>
				<span class="name">{g.name}</span>
				<span class="muted small">
					{g.terms} term{g.terms === 1 ? '' : 's'}{g.pending ? ` · ${g.pending} to look up` : ''}
				</span>
				<Icon name="chevron-right" />
			</a>
		{:else}
			<p class="none">No glossary yet. Start one below, or capture a term in a meeting.</p>
		{/each}
	</div>

	{#if problem}<p class="problem">{problem}</p>{/if}

	{#if data.unstarted.length}
		<p class="label">No glossary yet</p>
		<div class="sheet rows" data-testid="unstarted">
			{#each data.unstarted as g (g.slug)}
				<div class="glossary">
					<i style="--dot: {g.color}"></i>
					<span class="name">{g.name}</span>
					<button class="btn small" disabled={busy === g.slug} onclick={() => start(g.slug)} data-testid="start-glossary">
						Start a glossary
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); display: inline-block; }
	.glossary { display: flex; align-items: center; gap: 10px; color: var(--text); }
	a.glossary:hover { text-decoration: none; }
	a.glossary:hover .name { color: var(--accent); }
	.glossary .name { font-weight: 500; }
	.glossary .muted, .glossary .btn { margin-left: auto; text-align: right; }
	.glossary :global(svg) { color: var(--muted); flex: none; }
</style>

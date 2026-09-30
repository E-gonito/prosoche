<script lang="ts">
	/**
	 * Every glossary, and a way to start a new one. Creating one is the user's
	 * own act, so it writes straight away: `Glossaries/<name>.md` holding only
	 * a title, which the page then opens.
	 */
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { api } from '$lib/client/api';
	import { slugify } from '$lib/shared/slug';

	let { data } = $props();

	let name = $state('');
	let problem = $state('');
	let busy = $state(false);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		busy = true;
		problem = '';
		const result = await api('/api/glossary', { action: 'create-glossary', name });
		busy = false;
		if (!result.ok) problem = result.message;
		// Invalidates the root layout too, so the rail gains the new glossary.
		else await goto(`/glossary/${slugify(name)}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>Glossary · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Glossary</h1>
		<p>The words you had to guess at, one glossary per subject</p>
	</div>

	<div class="sheet rows" data-testid="glossaries">
		{#each data.glossaries as g (g.slug)}
			<a class="glossary" href="/glossary/{g.slug}">
				<i class="dot" style="--dot: {g.color}"></i>
				<span class="name">{g.name}</span>
				<span class="muted small">
					{g.terms} term{g.terms === 1 ? '' : 's'}{g.pending ? ` · ${g.pending} to look up` : ''}
				</span>
				<Icon name="chevron-right" />
			</a>
		{:else}
			<p class="empty">No glossary yet. Start one below.</p>
		{/each}
	</div>

	<p class="label">New glossary</p>
	<form class="new" onsubmit={create} data-testid="new-glossary-form">
		<input class="field" bind:value={name} placeholder="Name, e.g. Computer Science" aria-label="Glossary name" data-testid="new-glossary-name" />
		<button class="btn" type="submit" disabled={busy || !name.trim()} data-testid="new-glossary-create">Start a glossary</button>
	</form>
	{#if problem}<p class="problem">{problem}</p>{/if}
</div>

<style>
	.glossary { display: flex; align-items: center; gap: 10px; color: var(--text); }
	a.glossary:hover { text-decoration: none; }
	a.glossary:hover .name { color: var(--accent); }
	.glossary .name { font-weight: 500; }
	.glossary .muted { margin-left: auto; text-align: right; }
	.glossary :global(svg) { color: var(--muted); flex: none; }
	.new { display: flex; gap: var(--s2); flex-wrap: wrap; }
	.new .field { flex: 1 1 220px; width: auto; }
</style>

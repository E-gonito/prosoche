<script lang="ts">
	/**
	 * Every glossary, and a way to start a new one. Creating one is the user's
	 * own act, so it writes straight away: `Glossaries/<name>.md` holding only
	 * a title, which the page then opens. Each row's Edit (name and
	 * description) and Delete are the shared `EditDetails`, as on every
	 * module's list; a glossary's own page only shows them.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import EditDetails from '$lib/components/EditDetails.svelte';
	import { api } from '$lib/client/api';
	import { noteHref } from '$lib/shared/links';
	import { slugify } from '$lib/shared/slug';

	let { data } = $props();

	/** Reload once a write has gone through, and hand its result back either way. */
	async function reloaded<T extends { ok: boolean }>(result: T): Promise<T> {
		if (result.ok) await invalidateAll();
		return result;
	}

	const ask = (g: { terms: number }) => `Delete this glossary${g.terms ? ` and its ${g.terms} term${g.terms === 1 ? '' : 's'}` : ''}? Git history keeps the file.`;

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
			<div class="line" data-testid="glossary-row">
				<a class="glossary" href="/glossary/{g.slug}">
					<i class="dot" style="--dot: {g.color}"></i>
					<span class="main">
						<span class="name">{g.name}</span>
						{#if g.description}<span class="muted small desc">{g.description}</span>{/if}
					</span>
					<span class="muted small">
						{g.terms} term{g.terms === 1 ? '' : 's'}{g.pending ? ` · ${g.pending} to look up` : ''}
					</span>
					<Icon name="chevron-right" />
				</a>
				<EditDetails
					details={g}
					fileHref={noteHref(g.path)}
					save={async (changed) => reloaded(await api('/api/glossary', { action: 'edit-glossary', glossary: g.slug, ...changed }))}
					remove={async () => reloaded(await api('/api/glossary', { action: 'delete-glossary', glossary: g.slug }))}
					ask={ask(g)}
				/>
			</div>
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
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); }
	.glossary { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--text); }
	.main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	a.glossary:hover { text-decoration: none; }
	a.glossary:hover .name { color: var(--accent); }
	.glossary .name { font-weight: 500; }
	.glossary > .muted { margin-left: auto; text-align: right; flex: none; }
	.glossary :global(svg) { color: var(--muted); flex: none; }
	.new { display: flex; gap: var(--s2); flex-wrap: wrap; }
	.new .field { flex: 1 1 220px; width: auto; }
</style>

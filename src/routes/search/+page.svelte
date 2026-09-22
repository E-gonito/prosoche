<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { data } = $props();
	let box: HTMLInputElement | undefined = $state();

	// Focus the box on arrival, but only when there is nothing to read yet, so
	// landing on results does not steal focus from the list.
	$effect(() => {
		if (box && !data.query.trim()) box.focus();
	});
	const href = (p: string) => `/notes/${p.split('/').map(encodeURIComponent).join('/')}`;

	/** The index marks matches with «» so the UI can highlight without HTML. */
	function parts(snippet: string): Array<{ text: string; hit: boolean }> {
		return snippet.split(/«|»/).map((text, i) => ({ text, hit: i % 2 === 1 }));
	}
</script>

<svelte:head><title>{data.query ? `${data.query} · search` : 'Search'} · prosoche</title></svelte:head>

<PageHeader title="Search">
	{#snippet actions()}
		<form>
			<input bind:this={box} name="q" value={data.query} placeholder="Search your notes…" aria-label="Search notes" />
			<button class="btn primary">Search</button>
		</form>
	{/snippet}
</PageHeader>

{#if data.query.trim()}
	<p class="muted count">{data.hits.length} result{data.hits.length === 1 ? '' : 's'} for “{data.query}”</p>
	{#each data.hits as hit (hit.path)}
		<a class="card hit" href={href(hit.path)}>
			<b>{hit.title}</b>
			<span class="path">{hit.path}</span>
			<span class="snippet">
				{#each parts(hit.snippet) as part, i (i)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
			</span>
		</a>
	{:else}
		<div class="card">
			<EmptyState icon="search" title="Nothing matched." hint="Search covers note titles and bodies." />
		</div>
	{/each}
{:else}
	<div class="card">
		<EmptyState icon="search" title="Type something to search your vault." />
	</div>
{/if}

<style>
	form { display: flex; gap: 8px; flex: 1; min-width: 240px; max-width: 520px; }
	input { flex: 1; min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font: inherit; }
	.count { margin: 0 0 10px; font-size: 13px; }
	.hit { display: block; text-decoration: none; color: inherit; margin-bottom: 10px; }
	.hit:hover { border-color: var(--accent); }
	.hit b { display: block; }
	.path { display: block; font: 11px var(--mono); color: var(--muted); margin: 2px 0 6px; }
	.snippet { font-size: 13px; color: var(--muted); }
	mark { background: #fef08a; color: inherit; border-radius: 2px; }
</style>

<script lang="ts">
	/**
	 * The vault, read-only: search it, capture into it, browse it.
	 *
	 * Editing is Obsidian's job. The one write here is the capture box, which
	 * appends a line to `Inbox/Capture.md` and never touches a note on screen.
	 */
	import { api } from '$lib/client/api';
	import FileTree from '$lib/components/FileTree.svelte';
	import Capture from '$lib/components/Capture.svelte';
	import { noteHref, relativeDay } from '$lib/shared/links';

	let { data } = $props();

	type Hit = { path: string; title: string; snippet: string };
	let query = $state('');
	let hits = $state<Hit[]>([]);
	let problem = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Debounced so a word typed quickly is one request, not five.
	function search() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			hits = [];
			return;
		}
		timer = setTimeout(async () => {
			const result = await api<{ hits: Hit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
			hits = result.ok ? result.value.hits : [];
		}, 150);
	}

	/** The index marks matches with «»; drawn here as highlights. */
	function marked(snippet: string): string {
		const escaped = snippet.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
		return escaped.replace(/«/g, '<mark>').replace(/»/g, '</mark>');
	}
</script>

<svelte:head><title>Notes · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Notes</h1>
		<p>{data.notes} notes, read-only here. Edit them in Obsidian.</p>
	</div>

	<input
		class="field search"
		type="search"
		placeholder="Search the vault…"
		bind:value={query}
		oninput={search}
		aria-label="Search the vault"
		data-testid="notes-search"
	/>

	{#if query.trim()}
		<div class="sheet rows results" data-testid="search-results">
			{#each hits as hit (hit.path)}
				<a class="hit" href={noteHref(hit.path)}>
					<b>{hit.title}</b>
					<span class="muted small">{hit.path}</span>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<span class="snippet">{@html marked(hit.snippet)}</span>
				</a>
			{:else}
				<p class="empty">Nothing matches “{query.trim()}”.</p>
			{/each}
		</div>
	{/if}

	<p class="label">Capture</p>
	<Capture onproblem={(m) => (problem = m)} />
	{#if problem}<p class="problem">{problem}</p>{/if}

	<div class="split">
		<section>
			<p class="label">Recently changed</p>
			<div class="sheet rows">
				{#each data.recent as note (note.path)}
					<a class="recent" href={noteHref(note.path)}>
						<span class="name">{note.title}</span>
						<span class="muted small">{note.folder || 'vault root'} · {relativeDay(note.day, data.today)}</span>
					</a>
				{:else}
					<p class="empty">No notes yet.</p>
				{/each}
			</div>
		</section>

		<section>
			<p class="label">Browse</p>
			<div class="sheet tree"><FileTree nodes={data.tree} /></div>
		</section>
	</div>
</div>

<style>
	.search { margin-bottom: var(--s3); font-size: var(--t16); padding: 11px var(--s4); }
	.results { margin-bottom: var(--s3); }
	.hit, .recent { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
	.hit:hover, .recent:hover { text-decoration: none; }
	.hit:hover b, .recent:hover .name { color: var(--accent); }
	.snippet { font-size: var(--t13); color: var(--muted); }
	.snippet :global(mark) { background: var(--sand); color: var(--text); border-radius: 2px; }
	.name { font-weight: 500; }
	.split { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s5); margin-top: var(--s6); }
	.tree { max-height: 560px; overflow: auto; }
	@media (max-width: 720px) {
		.split { grid-template-columns: 1fr; gap: var(--s5); }
	}
</style>

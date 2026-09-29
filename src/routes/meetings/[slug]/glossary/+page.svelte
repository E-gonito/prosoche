<script lang="ts">
	/**
	 * The glossary, as in the artifact: a filter box, chips, and one entry per
	 * term with the user's guess beside the definition.
	 *
	 * Terms captured in meetings but not yet in Glossary.md wait at the top.
	 * Adding one is the user's own act and writes straight away. Looking one
	 * up is Claude's, so it arrives as a proposal and changes nothing until
	 * it is accepted.
	 */
	import { invalidateAll } from '$app/navigation';
	import Draft from '$lib/components/Draft.svelte';
	import { meetingAction } from '$lib/client/meetings';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	let query = $state('');
	let chip = $state<string>('all');
	let problem = $state('');
	let adding = $state<string | null>(null);

	const mine = $derived(data.entries.filter((e) => e.guess).length);
	const pending = $derived(data.entries.filter((e) => e.pending));
	const needle = $derived(query.trim().toLowerCase());
	const matches = (...fields: Array<string | null | undefined>) => !needle || fields.some((f) => f?.toLowerCase().includes(needle));

	const shown = $derived(
		data.entries.filter((e) => {
			if (chip === 'mine' && !e.guess) return false;
			if (chip === 'pending' && !e.pending) return false;
			if (chip.startsWith('cat:') && e.category !== chip.slice(4)) return false;
			return matches(e.term, e.guess, e.definition, e.relevance, e.category);
		})
	);
	const captured = $derived(data.captured.filter((c) => matches(c.term, c.guess)));

	async function add(term: (typeof data.captured)[number]) {
		adding = term.term;
		problem = '';
		const result = await meetingAction({ action: 'add-term', slug: data.workspace.slug, term: term.term, guess: term.guess, source: term.source });
		adding = null;
		if (!result.ok) problem = result.message;
		else await invalidateAll();
	}
</script>

<svelte:head><title>{data.workspace.name} · Glossary · prosoche</title></svelte:head>

<input class="field filter" type="search" bind:value={query} placeholder="Filter terms…" aria-label="Filter terms" data-testid="glossary-filter" />

<div class="chips" data-testid="glossary-chips">
	<button class="chip" class:on={chip === 'all'} onclick={() => (chip = 'all')}>All</button>
	<button class="chip" class:on={chip === 'mine'} onclick={() => (chip = 'mine')}>Mine ({mine})</button>
	<button class="chip" class:on={chip === 'pending'} onclick={() => (chip = 'pending')}>To look up</button>
	{#each data.categories as category (category)}
		<button class="chip" class:on={chip === `cat:${category}`} onclick={() => (chip = `cat:${category}`)}>{category}</button>
	{/each}
</div>

<div class="count">
	<span class="muted small" data-testid="glossary-count">{shown.length} of {data.entries.length} terms</span>
	{#if pending.length}
		<Draft
			label="Look up all ({pending.length})"
			title="Claude drafts every definition still to look up, in one proposal. Nothing is written until you accept."
			request={{ feature: 'glossary-lookup', slug: data.workspace.slug }}
			ondone={() => invalidateAll()}
		/>
	{/if}
</div>

{#if problem}<p class="problem">{problem}</p>{/if}

{#if captured.length}
	<p class="label">Captured in meetings <span class="right">{captured.length}</span></p>
	<div class="sheet rows" data-testid="captured-terms">
		{#each captured as term (term.term)}
			<div class="captured">
				<div>
					<b>{term.term}</b>
					{#if term.guess}<p class="guess"><b>My guess:</b> {term.guess}</p>{/if}
					<small class="muted">From <a href={noteHref(term.meeting.path)}>{term.meeting.title}{term.meeting.date ? ` ${term.meeting.date}` : ''}</a></small>
				</div>
				<button class="btn small" disabled={adding === term.term} onclick={() => add(term)} data-testid="add-term">Add to glossary</button>
			</div>
		{/each}
	</div>
	<p class="label">Glossary</p>
{/if}

{#if data.entries.length}
	<div class="sheet rows entries" data-testid="glossary-entries">
		{#each shown as entry (entry.term)}
			<article class="entry" data-testid="glossary-entry">
				<h3>
					{entry.term}
					{#if entry.guess}<span class="badge">Mine</span>{/if}
					{#if entry.lookedUp}<span class="badge ok">Looked up</span>{:else if entry.pending}<span class="badge warn">To look up</span>{/if}
				</h3>
				{#if entry.guess}<p class="guess"><b>My guess:</b> {entry.guess}</p>{/if}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{#if entry.definition}<div class="definition">{@html entry.definition}</div>{/if}
				{#if entry.relevance}<p class="relevance"><span>→</span> {entry.relevance}</p>{/if}
				{#if entry.source || entry.drafted}
					<p class="from">
						{#if entry.source}{'From '}{#if entry.source.href}<a href={entry.source.href}>{entry.source.label}</a>{:else}{entry.source.label}{/if}{/if}{#if entry.source && entry.drafted}{' · '}{/if}{#if entry.drafted}definition drafted by Claude{/if}
					</p>
				{/if}
				{#if entry.pending}
					<div class="lookup">
						<Draft
							label="Look up with Claude"
							title="Claude drafts a definition and why it matters here. Nothing is written until you accept."
							request={{ feature: 'glossary-lookup', slug: data.workspace.slug, terms: [entry.term] }}
							ondone={() => invalidateAll()}
						/>
					</div>
				{/if}
			</article>
		{:else}
			<p class="none">No term matches.</p>
		{/each}
	</div>
{:else}
	<p class="none">No glossary yet. Capture a term in a meeting, then add it here{data.path ? `; it goes in ${data.path}` : ''}.</p>
{/if}

<style>
	.filter { margin-bottom: var(--s3); }
	.count { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; margin: var(--s3) 0 var(--s4); }
	.count :global(.draft:has(.proposal)) { flex-basis: 100%; }
	.captured { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
	.entry h3 { font-size: var(--t16); margin: 0 0 var(--s1); display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.guess { margin: 0 0 var(--s1); font-size: var(--t14); }
	.definition { font-size: var(--t15); line-height: 1.55; }
	.definition :global(p) { margin: 0 0 var(--s1); }
	.relevance { margin: var(--s1) 0; font-size: var(--t14); color: var(--muted); }
	.relevance span { color: var(--accent); }
	.from { margin: var(--s1) 0 0; font-size: var(--t13); color: var(--muted); }
	.lookup { margin-top: var(--s2); }
	.captured small { font-size: var(--t12); }
</style>

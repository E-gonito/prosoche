<script lang="ts">
	/**
	 * One workspace's glossary, as in the artifact: a filter box, a tab per
	 * category, and one entry per term with its definition and why it matters.
	 *
	 * Terms captured in meetings but not yet in Glossary.md wait at the top.
	 * Adding one, typing a new one in, editing or deleting one is the user's own
	 * act and writes straight away. Looking one up is Claude's, so it arrives as a proposal
	 * and changes nothing until it is accepted.
	 */
	import { invalidateAll } from '$app/navigation';
	import Draft from '$lib/components/Draft.svelte';
	import StartMeeting from '$lib/components/StartMeeting.svelte';
	import { glossaryAction } from '$lib/client/glossary';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	let query = $state('');
	/** 'all', 'pending', or `cat:<category>`. */
	let tab = $state<string>('all');
	let problem = $state('');
	let adding = $state<string | null>(null);
	let fresh = $state({ term: '', category: '' });
	/** The term being edited, by its name as loaded, and the form's values. */
	let editing = $state<string | null>(null);
	let draft = $state({ term: '', category: '', definition: '', relevance: '' });
	let saving = $state(false);

	const pending = $derived(data.entries.filter((e) => e.pending));
	const needle = $derived(query.trim().toLowerCase());
	const matches = (...fields: Array<string | null | undefined>) => !needle || fields.some((f) => f?.toLowerCase().includes(needle));

	const shown = $derived(
		data.entries.filter((e) => {
			if (tab === 'pending' && !e.pending) return false;
			if (tab.startsWith('cat:') && e.category !== tab.slice(4)) return false;
			return matches(e.term, e.definition, e.relevance, e.category);
		})
	);
	const captured = $derived(data.captured.filter((c) => matches(c.term)));
	const inCategory = (category: string) => data.entries.filter((e) => e.category === category).length;

	async function add(term: { term: string; category?: string | null; source?: string | null }): Promise<boolean> {
		adding = term.term;
		problem = '';
		const result = await glossaryAction({ action: 'add', slug: data.workspace.slug, ...term });
		adding = null;
		if (!result.ok) problem = result.message;
		else await invalidateAll();
		return result.ok;
	}

	function edit(entry: (typeof data.entries)[number]) {
		problem = '';
		editing = entry.term;
		draft = { term: entry.term, category: entry.category ?? '', definition: entry.definitionRaw, relevance: entry.relevance ?? '' };
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!editing || !draft.term.trim()) return;
		saving = true;
		problem = '';
		const result = await glossaryAction({ action: 'edit', slug: data.workspace.slug, term: editing, change: draft });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		editing = null;
		await invalidateAll();
	}

	async function remove(term: string) {
		if (!confirm(`Delete “${term}” from the glossary?`)) return;
		problem = '';
		const result = await glossaryAction({ action: 'delete', slug: data.workspace.slug, term });
		if (!result.ok) problem = result.message;
		else {
			if (editing === term) editing = null;
			await invalidateAll();
		}
	}

	async function addFresh(event: SubmitEvent) {
		event.preventDefault();
		if (!fresh.term.trim()) return;
		if (await add({ term: fresh.term, category: fresh.category || null })) {
			fresh = { term: '', category: '' };
		}
	}
</script>

<svelte:head><title>{data.workspace.name} · Glossary · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/glossary">Glossary</a>
		<h1><i style="--dot: {data.workspace.color}"></i>{data.workspace.name}</h1>
		<p class="sub">
			<span>What each term means, and why it matters here{#if data.meetings}{' · '}<a href="/meetings/{data.workspace.slug}">meeting notebook</a>{/if}</span>
			<StartMeeting slug={data.workspace.slug} meetings={data.meetings} small />
		</p>
	</div>

	{#if !data.path}
		<p class="callout">
			<b>No folder.</b> This workspace has no folder, so there is nowhere to keep a glossary. Add one to
			<code>folders</code> in its workspace file.
		</p>
	{:else}
		<form class="add" onsubmit={addFresh} data-testid="add-term-form">
			<input class="field" bind:value={fresh.term} placeholder="New term" aria-label="Term" data-testid="new-term" />
			<input class="field" bind:value={fresh.category} placeholder="Category" aria-label="Category" list="glossary-categories" data-testid="new-category" />
			<datalist id="glossary-categories">
				{#each data.categories as category (category)}<option value={category}></option>{/each}
			</datalist>
			<button class="btn" type="submit" disabled={!fresh.term.trim() || adding !== null} data-testid="new-add">Add term</button>
		</form>

		<input class="field filter" type="search" bind:value={query} placeholder="Filter terms…" aria-label="Filter terms" data-testid="glossary-filter" />

		<div class="tabs cat-tabs" role="tablist" aria-label="Categories" data-testid="glossary-tabs">
			<button role="tab" aria-selected={tab === 'all'} onclick={() => (tab = 'all')}>All<span class="n">{data.entries.length}</span></button>
			{#each data.categories as category (category)}
				<button role="tab" aria-selected={tab === `cat:${category}`} onclick={() => (tab = `cat:${category}`)}>
					{category}<span class="n">{inCategory(category)}</span>
				</button>
			{/each}
			{#if pending.length}
				<button role="tab" aria-selected={tab === 'pending'} onclick={() => (tab = 'pending')}>To look up<span class="n">{pending.length}</span></button>
			{/if}
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
							<small class="muted">From <a href={noteHref(term.meeting.path)}>{term.meeting.title}{term.meeting.date ? ` ${term.meeting.date}` : ''}</a></small>
						</div>
						<button class="btn small" disabled={adding === term.term} onclick={() => add({ term: term.term, source: term.source })} data-testid="add-term">Add to glossary</button>
					</div>
				{/each}
			</div>
			<p class="label">Glossary</p>
		{/if}

		{#if data.entries.length}
			<div class="sheet rows entries" data-testid="glossary-entries">
				{#each shown as entry (entry.term)}
					<article class="entry" data-testid="glossary-entry">
						{#if editing === entry.term}
							<form class="edit" onsubmit={save} data-testid="edit-term-form">
								<div class="edit-row">
									<input class="field" bind:value={draft.term} aria-label="Term" data-testid="edit-term" />
									<input class="field" bind:value={draft.category} placeholder="Category" aria-label="Category" list="glossary-categories" data-testid="edit-category" />
								</div>
								<textarea class="field" rows="3" bind:value={draft.definition} placeholder="Definition" aria-label="Definition" data-testid="edit-definition"></textarea>
								<input class="field" bind:value={draft.relevance} placeholder="Why it matters here" aria-label="Why it matters here" data-testid="edit-relevance" />
								<div class="edit-row">
									<button class="btn primary" type="submit" disabled={saving || !draft.term.trim()} data-testid="edit-save">{saving ? 'Saving…' : 'Save'}</button>
									<button class="btn ghost" type="button" onclick={() => (editing = null)}>Cancel</button>
								</div>
							</form>
						{:else}
							<h3>
								{entry.term}
								{#if entry.pending}<span class="badge warn">To look up</span>{/if}
								<span class="actions">
									<button class="btn ghost small" onclick={() => edit(entry)} data-testid="edit-term-open">Edit</button>
									<button class="btn ghost small remove" onclick={() => remove(entry.term)} data-testid="delete-term">Delete</button>
								</span>
							</h3>
							{#if entry.category}<p class="category">{entry.category}</p>{/if}
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
						{/if}
					</article>
				{:else}
					<p class="none">No term matches.</p>
				{/each}
			</div>
		{:else}
			<p class="none">No terms yet. Add one above{data.meetings ? ', or capture one in a meeting' : ''}; it goes in {data.path}.</p>
		{/if}
	{/if}
</div>

<style>
	h1 { display: flex; align-items: center; gap: 10px; }
	h1 i { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--dot); }
	code { font: var(--t13) var(--mono); }
	.add { display: flex; gap: var(--s2); flex-wrap: wrap; margin-bottom: var(--s4); }
	.add .field { flex: 1 1 140px; width: auto; }
	.add .field:first-child { flex-basis: 180px; }
	.filter { margin-bottom: var(--s3); }
	.count { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; margin: var(--s3) 0 var(--s4); }
	.count :global(.draft:has(.proposal)) { flex-basis: 100%; }
	.captured { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
	.entry h3 { font-size: var(--t16); margin: 0 0 var(--s1); display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.sub { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
	.cat-tabs { margin-bottom: var(--s2); }
	.cat-tabs button {
		padding: var(--s2) var(--s3);
		border: 0;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		background: none;
		font: inherit;
		font-size: var(--t14);
		font-weight: 500;
		color: var(--muted);
		white-space: nowrap;
		cursor: pointer;
	}
	.cat-tabs button:hover { color: var(--text); }
	.cat-tabs [aria-selected='true'] { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
	/* `.n`, not `.count`: this page's `.count` is the "6 of 17 terms" row. */
	.cat-tabs .n { color: var(--muted); font-weight: 400; margin-left: 4px; }
	/* Inside an h3, so the buttons would take its serif; they are controls, not
	   part of the term. `.remove` rather than `.danger`, which is the global
	   filled red button and would put red text on red. */
	.actions { margin-left: auto; display: flex; gap: var(--s1); font-family: var(--sans); font-weight: 500; }
	.actions .remove { color: var(--bad); }
	.actions .remove:hover { background: var(--soft); color: var(--bad); }
	.edit { display: flex; flex-direction: column; gap: var(--s2); }
	.edit-row { display: flex; gap: var(--s2); flex-wrap: wrap; }
	.edit-row .field { flex: 1 1 180px; width: auto; }
	.edit textarea { resize: vertical; font: inherit; }
	.category { margin: 0 0 var(--s1); font-size: var(--t12); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
	.definition { font-size: var(--t15); line-height: 1.55; }
	.definition :global(p) { margin: 0 0 var(--s1); }
	.relevance { margin: var(--s1) 0; font-size: var(--t14); color: var(--muted); }
	.relevance span { color: var(--accent); }
	.from { margin: var(--s1) 0 0; font-size: var(--t13); color: var(--muted); }
	.lookup { margin-top: var(--s2); }
	.captured small { font-size: var(--t12); }
</style>

<script lang="ts">
	/**
	 * One glossary, as in the artifact: a filter box, a tab per category, and
	 * one entry per term with its definition and why it matters.
	 *
	 * Typing a new term in, editing or deleting one, and renaming or deleting
	 * the glossary, are the user's own acts and write straight away. Looking a
	 * term up is Claude's: it arrives as a proposal and changes nothing until
	 * the user accepts.
	 *
	 * The Flashcards line links the glossary to a study subject, whose cards
	 * the server then keeps in step with every term, and says how they
	 * stand.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import Draft from '$lib/components/Draft.svelte';
	import { api } from '$lib/client/api';
	import { slugify } from '$lib/shared/slug';

	let { data } = $props();

	const slug = $derived(data.glossary.slug);

	/** The glossary's own name and existence: rename in place, delete asked twice. */
	let renaming = $state<string | null>(null);
	let confirmingDelete = $state(false);

	async function rename(event: SubmitEvent) {
		event.preventDefault();
		if (renaming === null || !renaming.trim()) return;
		problem = '';
		const result = await api('/api/glossary', { action: 'rename-glossary', glossary: slug, name: renaming });
		if (!result.ok) {
			problem = result.message;
			return;
		}
		const to = slugify(renaming);
		renaming = null;
		await goto(`/glossary/${to}`, { invalidateAll: true, replaceState: true });
	}

	async function removeGlossary() {
		problem = '';
		const result = await api('/api/glossary', { action: 'delete-glossary', glossary: slug });
		if (!result.ok) {
			confirmingDelete = false;
			problem = result.message;
			return;
		}
		await goto('/glossary', { invalidateAll: true, replaceState: true });
	}

	// The page is reused when the rail moves to another glossary; its own
	// half-done asks do not carry over.
	$effect(() => {
		void slug;
		renaming = null;
		confirmingDelete = false;
	});

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
	const inCategory = (category: string) => data.entries.filter((e) => e.category === category).length;

	async function add(term: { term: string; category?: string | null }): Promise<boolean> {
		adding = term.term;
		problem = '';
		const result = await api('/api/glossary', { action: 'add', glossary: slug, ...term });
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
		const result = await api('/api/glossary', { action: 'edit', glossary: slug, term: editing, change: draft });
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
		const result = await api('/api/glossary', { action: 'delete', glossary: slug, term });
		if (!result.ok) problem = result.message;
		else {
			if (editing === term) editing = null;
			await invalidateAll();
		}
	}

	/** The subject the picker shows: the linked one, the unknown slug, or none. */
	const study = $derived(data.cards.state === 'linked' ? data.cards.subject.slug : data.cards.state === 'unknown' ? data.cards.study : '');
	let linking = $state(false);

	async function link(slug: string) {
		linking = true;
		problem = '';
		const result = await api('/api/glossary', { action: 'set-study', glossary: data.glossary.slug, study: slug });
		linking = false;
		if (!result.ok) problem = result.message;
		await invalidateAll();
	}

	async function addFresh(event: SubmitEvent) {
		event.preventDefault();
		if (!fresh.term.trim()) return;
		if (await add({ term: fresh.term, category: fresh.category || null })) {
			fresh = { term: '', category: '' };
		}
	}
</script>

<svelte:head><title>{data.glossary.name} · Glossary · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/glossary">Glossary</a>
		{#if renaming !== null}
			<form class="rename" onsubmit={rename} data-testid="rename-form">
				<!-- svelte-ignore a11y_autofocus -->
				<input class="field" bind:value={renaming} aria-label="Glossary name" autofocus data-testid="rename-name" />
				<button class="btn primary small" type="submit" disabled={!renaming.trim()} data-testid="rename-save">Rename</button>
				<button class="btn ghost small" type="button" onclick={() => (renaming = null)}>Cancel</button>
			</form>
		{:else}
			<h1><i class="dot lg" style="--dot: {data.glossary.color}"></i>{data.glossary.name}</h1>
		{/if}
		<p class="sub">
			<span>What each term means, and why it matters</span>
			<span class="own">
				{#if confirmingDelete}
					<span class="ask" data-testid="delete-glossary-ask">
						Delete this glossary{data.entries.length ? ` and its ${data.entries.length} term${data.entries.length === 1 ? '' : 's'}` : ''}?
						<button class="btn ghost small remove" onclick={removeGlossary} data-testid="delete-glossary-confirm">Delete</button>
						<button class="btn ghost small" onclick={() => (confirmingDelete = false)}>Keep</button>
					</span>
				{:else if renaming === null}
					<button class="btn ghost small" onclick={() => (renaming = data.glossary.name)} data-testid="rename-glossary">Rename</button>
					<button class="btn ghost small remove" onclick={() => (confirmingDelete = true)} data-testid="delete-glossary">Delete</button>
				{/if}
			</span>
		</p>
	</div>

	<div class="cards" data-testid="glossary-cards">
		<label for="glossary-study">Flashcards</label>
		<select id="glossary-study" class="field" value={study} disabled={linking} onchange={(e) => link(e.currentTarget.value)} data-testid="glossary-study">
			<option value="">Not linked</option>
			{#each data.subjects as subject (subject.slug)}<option value={subject.slug}>{subject.name}</option>{/each}
			{#if data.cards.state === 'unknown'}<option value={data.cards.study}>{data.cards.study} (not a study subject)</option>{/if}
		</select>
		<span class="small" data-testid="glossary-cards-state">
			{#if data.cards.state === 'linked'}
				<a href="/study/{data.cards.subject.slug}/flashcards">{data.cards.cards} {data.cards.cards === 1 ? 'card' : 'cards'} in {data.cards.subject.name}</a>
				<span class="muted">· {data.cards.pending ? `${data.cards.pending} ${data.cards.pending === 1 ? 'file' : 'files'} to update` : 'up to date'}</span>
			{:else if data.cards.state === 'unknown'}
				<span class="muted">Not linked: “{data.cards.study}” is not a study subject, so no cards are kept.</span>
			{:else}
				<span class="muted">Not linked. Pick a study subject to make every term a card there.</span>
			{/if}
		</span>
	</div>
	{#if data.cards.state === 'linked' && data.cards.problems.length}
		<ul class="hint card-problems" data-testid="glossary-cards-problems">
			{#each data.cards.problems as p (p)}<li>{p}</li>{/each}
		</ul>
	{/if}

	<form class="add-row add" onsubmit={addFresh} data-testid="add-term-form">
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
				endpoint="/api/glossary/lookup"
				request={{ glossary: slug }}
				ondone={() => invalidateAll()}
			/>
		{/if}
	</div>

	{#if problem}<p class="problem">{problem}</p>{/if}

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
									endpoint="/api/glossary/lookup"
									request={{ glossary: slug, terms: [entry.term] }}
									ondone={() => invalidateAll()}
								/>
							</div>
						{/if}
					{/if}
				</article>
			{:else}
				<p class="empty">No term matches.</p>
			{/each}
		</div>
	{:else}
		<p class="empty">
			No terms yet. Add one above; it goes in <code>{data.glossary.path}</code>.
		</p>
	{/if}
</div>

<style>
	h1 { display: flex; align-items: center; gap: 10px; }
	code { font: var(--t13) var(--mono); }
	.cards { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin-bottom: var(--s3); }
	.cards label { font-size: var(--t12); font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
	.cards .field { width: auto; flex: 0 1 220px; font-size: var(--t13); }
	.card-problems { margin: 0 0 var(--s3); padding-left: var(--s4); }
	.add { flex-wrap: wrap; margin-bottom: var(--s4); }
	.add .field { flex: 1 1 140px; }
	.add .field:first-child { flex-basis: 180px; }
	.filter { margin-bottom: var(--s3); }
	.count { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; margin: var(--s3) 0 var(--s4); }
	.count :global(.draft:has(.proposal)) { flex-basis: 100%; }
	.entry h3 { font-size: var(--t16); margin: 0 0 var(--s1); display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.sub { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
	.own { display: flex; align-items: center; gap: var(--s1); flex-wrap: wrap; }
	.own .remove, .ask .remove { color: var(--bad); }
	.ask { font-size: var(--t13); display: inline-flex; align-items: center; gap: var(--s1); flex-wrap: wrap; }
	.rename { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin: var(--s1) 0 var(--s2); }
	.rename .field { flex: 1 1 220px; width: auto; font: var(--t20) var(--serif); }
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
</style>

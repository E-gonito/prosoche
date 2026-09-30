<script lang="ts">
	/**
	 * A glossary's scan for new terms: the folders it is scanned from, one
	 * button that reads the notes changed since the last scan batch by batch,
	 * and the terms Claude found, to tick, edit and add.
	 *
	 * The folders are the glossary's own `sources:`, edited in a
	 * `FolderEditor` that saves each change at once. Scanning writes nothing:
	 * each batch's candidates join one list, de-duplicated against the
	 * glossary and each other, and the ones their note does not support wait
	 * under Left out. A term the scan missed can be typed into the list too.
	 * Add sends only the ticked entries, as edited, for the server to check
	 * again and append; that press is the accept step. A scan that read every
	 * note it meant to also marks the glossary scanned today. Discarding a
	 * list not yet added asks first, in place.
	 */
	import { invalidateAll } from '$app/navigation';
	import FolderEditor from '$lib/components/FolderEditor.svelte';
	import { api } from '$lib/client/api';
	import { ENTRY_LIMITS, normaliseTerm, type ScanCandidate, type ScanDraft, type ScanPlan } from '$lib/shared/glossary';
	import { noteHref } from '$lib/shared/links';

	let {
		slug,
		path,
		plan,
		folders,
		categories,
		terms,
		aiEnabled,
		cards
	}: {
		/** The glossary, by slug. */
		slug: string;
		/** Its file, to say where Add writes. */
		path: string;
		plan: ScanPlan;
		/** Every folder it may be scanned from. */
		folders: string[];
		/** Its categories, offered for each new term. */
		categories: string[];
		/** The terms it has now. */
		terms: string[];
		aiEnabled: boolean;
		/** The study subject its terms become cards in, when it is linked to one. */
		cards: { name: string; href: string } | null;
	} = $props();

	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	/** "29 Sep", with the year when it is not this one. Written out, since `en-GB` now says "Sept". */
	function short(day: string): string {
		const [y, m, d] = day.split('-').map(Number);
		return `${d} ${MONTHS[m - 1]}${y === new Date().getFullYear() ? '' : ` ${y}`}`;
	}

	let problem = $state('');

	/* --------------------------------------------------------------- scan -- */

	type Row = ScanCandidate & { id: number; keep: boolean; drafted: boolean };
	let rows = $state<Row[]>([]);
	let leftOut = $state<ScanCandidate[]>([]);
	let running = $state(false);
	let progress = $state<{ at: number; of: number } | null>(null);
	/** How the last scan ended; null before one has run on this page. */
	let outcome = $state<{ notes: number; done: number; of: number; complete: boolean } | null>(null);
	/** The in-place question before a list not yet added is thrown away. */
	let asking = $state<{ scan: boolean; all: boolean } | null>(null);
	let controller: AbortController | null = null;
	let stopping = false;
	let nextId = 0;

	const since = $derived(plan.scanned ? short(plan.scanned) : null);
	const known = $derived(new Set(terms.map(normaliseTerm)));

	/** Scan, or first ask about the list it would replace. */
	function start(all: boolean) {
		if (rows.length) asking = { scan: true, all };
		else void scan(all);
	}

	/**
	 * Run every batch of the scan in turn, `all` notes or only those changed
	 * since the last scan, adding what each finds to the list. Stops at the
	 * first problem, or when Stop is pressed.
	 */
	async function scan(all: boolean) {
		if (running || !aiEnabled) return;
		asking = null;
		problem = '';
		added = null;
		rows = [];
		leftOut = [];
		filter = null;
		outcome = null;
		running = true;
		stopping = false;
		// The plan as the vault is now, not as it was when the page loaded.
		await invalidateAll();
		const batches = (all ? plan.all : plan.changed).batches;
		let done = 0;
		let notes = 0;
		for (const [i, paths] of batches.entries()) {
			if (stopping) break;
			progress = { at: i + 1, of: batches.length };
			controller = new AbortController();
			const found = rows.map((r) => r.term);
			const result = await api<ScanDraft>('/api/glossary/scan', { glossary: slug, paths, found }, { signal: controller.signal });
			if (stopping) break;
			if (!result.ok || result.value.problem) {
				problem = result.ok ? result.value.problem! : result.message;
				break;
			}
			done++;
			notes += result.value.read.length;
			const seen = new Set([...known, ...rows.map((r) => normaliseTerm(r.term))]);
			for (const candidate of result.value.candidates) {
				const key = normaliseTerm(candidate.term);
				if (!key || seen.has(key)) continue;
				seen.add(key);
				rows.push({ ...candidate, id: nextId++, keep: true, drafted: true });
			}
			leftOut.push(...result.value.leftOut);
		}
		outcome = { notes, done, of: batches.length, complete: done === batches.length };
		running = false;
		progress = null;
		controller = null;
	}

	function stop() {
		stopping = true;
		controller?.abort();
	}

	// Leaving the page stops the scan rather than letting it run on unseen.
	$effect(() => () => stop());

	/* ------------------------------------------------------------- review -- */

	/** The category shown, '' for none; null shows every one. */
	let filter = $state<string | null>(null);
	const groups = $derived.by(() => {
		const count = new Map<string, number>();
		for (const row of rows) count.set(row.category.trim(), (count.get(row.category.trim()) ?? 0) + 1);
		return [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
	});
	const shown = $derived(filter === null ? rows : rows.filter((r) => r.category.trim() === filter));
	const offeredCategories = $derived([...new Set([...categories, ...rows.map((r) => r.category.trim()).filter(Boolean)])].sort());
	const kept = $derived(rows.filter((r) => r.keep));

	/** What stops a ticked row from being added, by row id. */
	const issues = $derived.by(() => {
		const count = new Map<string, number>();
		for (const row of kept) count.set(normaliseTerm(row.term), (count.get(normaliseTerm(row.term)) ?? 0) + 1);
		const out = new Map<number, string>();
		for (const row of kept) {
			const key = normaliseTerm(row.term);
			if (!key) out.set(row.id, 'Needs a term.');
			else if (known.has(key)) out.set(row.id, 'The glossary already has this term.');
			else if ((count.get(key) ?? 0) > 1) out.set(row.id, 'This term is in the list twice.');
			else if (row.relevance.trim() && !row.definition.trim()) out.set(row.id, 'A → line needs a definition.');
		}
		return out;
	});

	const rowsFor = (text: string) => Math.min(8, Math.max(2, text.split('\n').length, Math.ceil(text.length / 80)));

	function tick(keep: boolean) {
		for (const row of shown) row.keep = keep;
	}

	/** A term typed into the list: no note, no quote, to look up unless given a definition. */
	let typed = $state('');
	function addTyped(event: SubmitEvent) {
		event.preventDefault();
		const term = typed.trim();
		if (!term) return;
		rows.push({ term, category: filter ?? '', definition: '', relevance: '', source: '', note: '', quote: '', id: nextId++, keep: true, drafted: false });
		typed = '';
	}

	/* ---------------------------------------------------------------- add -- */

	let adding = $state(false);
	let added = $state<{ n: number; marked: boolean } | null>(null);

	/** Send the ticked entries, as edited; with none, only mark the notes scanned. */
	async function add() {
		if (adding || running || issues.size) return;
		const complete = outcome?.complete === true;
		if (kept.length === 0 && !complete) return;
		adding = true;
		problem = '';
		const entries = kept.map((r) => ({ term: r.term, category: r.category, definition: r.definition, relevance: r.relevance, source: r.source, drafted: r.drafted }));
		const result = await api<{ added: number }>('/api/glossary', { action: 'add-scanned', glossary: slug, entries, complete });
		adding = false;
		if (!result.ok) {
			problem = result.message;
			// The glossary may have changed; show the list against it as it is now.
			await invalidateAll();
			return;
		}
		added = { n: result.value.added ?? entries.length, marked: complete };
		rows = [];
		leftOut = [];
		filter = null;
		outcome = null;
		await invalidateAll();
	}

	function discard() {
		asking = null;
		rows = [];
		filter = null;
	}
</script>

<section class="scan" data-testid="glossary-scan">
	<FolderEditor
		slug="glossary-{slug}"
		home={false}
		folders={plan.sources}
		options={folders}
		save={(next) => api('/api/glossary', { action: 'set-sources', glossary: slug, sources: next })}
		empty="No folders yet. Add one, and Claude reads its notes for terms this glossary lacks."
		hint=""
		disabled={running}
	/>

	{#if cards}
		<p class="hint" data-testid="scan-cards">Terms you add become cards in <a href={cards.href}>{cards.name}</a> once they have a definition.</p>
	{/if}
	{#if !aiEnabled}
		<p class="callout" data-testid="ai-off"><b>AI is off.</b> Claude cannot scan until it is on. <a href="/settings">Turn it on in Settings</a>.</p>
	{/if}

	{#if plan.sources.length === 0}
		<!-- The folder editor says what to do. -->
	{:else if plan.all.notes === 0}
		<p class="empty go">There are no notes under {plan.sources.length === 1 ? 'this folder' : 'these folders'} yet.</p>
	{:else if running}
		<div class="go" aria-live="polite" data-testid="scan-progress">
			<span>Batch {progress?.at ?? 1} of {progress?.of ?? 1} · {plural(rows.length, 'new term')} so far</span>
			<button class="btn small" onclick={stop} data-testid="scan-stop">Stop</button>
		</div>
	{:else if asking?.scan}
		<div class="go" data-testid="scan-ask">
			<span>Discard the {plural(rows.length, 'term')} not yet added?</span>
			<button class="btn ghost small remove" onclick={() => scan(asking?.all ?? false)} data-testid="scan-ask-confirm">Discard and scan</button>
			<button class="btn ghost small" onclick={() => (asking = null)}>Keep</button>
		</div>
	{:else}
		<div class="go">
			{#if since}
				<button class="btn primary" disabled={!aiEnabled || plan.changed.notes === 0} onclick={() => start(false)} data-testid="scan-run">
					{plan.changed.notes ? `Scan ${plural(plan.changed.notes, 'note')} changed since ${since}` : `No notes changed since ${since}`}
				</button>
				<button class="btn ghost" disabled={!aiEnabled} onclick={() => start(true)} data-testid="scan-all">Scan all {plural(plan.all.notes, 'note')} instead</button>
			{:else}
				<button class="btn primary" disabled={!aiEnabled} onclick={() => start(true)} data-testid="scan-run">Scan all {plural(plan.all.notes, 'note')}</button>
			{/if}
		</div>
	{/if}

	{#if outcome}
		<p class="hint" data-testid="scan-outcome">
			{outcome.complete ? `Read ${plural(outcome.notes, 'note')}` : `Stopped after batch ${outcome.done} of ${outcome.of}`} · {plural(rows.length, 'new term')}.
			{#if outcome.complete && rows.length === 0}
				<button class="btn ghost small" disabled={adding} onclick={add} data-testid="scan-mark">Mark these notes scanned</button> so the next scan reads only notes changed from today.
			{/if}
		</p>
	{/if}
	{#if added}
		<p class="callout done" role="status" data-testid="scan-added">
			{#if added.n}<b>Added {plural(added.n, 'term')}.</b>{/if}{added.marked ? `${added.n ? ' ' : ''}The notes are marked scanned today.` : ''}
		</p>
	{/if}
	{#if problem}<p class="problem" role="status" data-testid="scan-problem">{problem}</p>{/if}

	{#if leftOut.length}
		<details class="hint left-out" data-testid="scan-left-out">
			<summary>Left out: {plural(leftOut.length, 'term')} whose note does not bear {leftOut.length === 1 ? 'it' : 'them'} out</summary>
			<ul>
				{#each leftOut as c, i (i)}
					<li><b>{c.term}</b> <span class="muted">“{c.quote}”</span> <a href={noteHref(c.source)}>{c.note}</a></li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if rows.length}
		<p class="label">
			New terms
			<span class="right">
				<button type="button" class="btn ghost small" onclick={() => tick(true)} data-testid="scan-select-all">Select all</button>
				<button type="button" class="btn ghost small" onclick={() => tick(false)} data-testid="scan-select-none">None</button>
			</span>
		</p>
		{#if groups.length > 1}
			<div class="chips groups" role="group" aria-label="Show a category" data-testid="scan-categories">
				<button type="button" class="chip" class:on={filter === null} aria-pressed={filter === null} onclick={() => (filter = null)}>All {rows.length}</button>
				{#each groups as g (g.name)}
					<button type="button" class="chip" class:on={filter === g.name} aria-pressed={filter === g.name} onclick={() => (filter = g.name)}>{g.name || 'No category'} {g.n}</button>
				{/each}
			</div>
		{/if}
		<datalist id="scan-categories-list">
			{#each offeredCategories as c (c)}<option value={c}></option>{/each}
		</datalist>
		<div class="sheet rows" data-testid="scan-candidates">
			{#each shown as row (row.id)}
				<div class="found" class:off={!row.keep} data-testid="scan-candidate">
					<button
						type="button"
						class="box"
						aria-pressed={row.keep}
						aria-label="Add {row.term || 'this term'}"
						onclick={() => (row.keep = !row.keep)}
						data-testid="scan-keep">{row.keep ? '✓' : ''}</button
					>
					<div class="fields">
						<div class="line">
							<input class="field term" bind:value={row.term} maxlength={ENTRY_LIMITS.term} aria-label="Term" data-testid="scan-term" />
							<input class="field" bind:value={row.category} maxlength={ENTRY_LIMITS.category} list="scan-categories-list" placeholder="Category" aria-label="Category" data-testid="scan-category" />
						</div>
						<textarea class="field" bind:value={row.definition} maxlength={ENTRY_LIMITS.definition} rows={rowsFor(row.definition)} placeholder="Definition, or leave empty to look it up later" aria-label="Definition" data-testid="scan-definition"></textarea>
						<div class="why">
							<span aria-hidden="true">→</span>
							<input class="field" bind:value={row.relevance} maxlength={ENTRY_LIMITS.relevance} placeholder="Why it matters here" aria-label="Why it matters here" data-testid="scan-relevance" />
						</div>
						{#if row.quote}<p class="quote">“{row.quote}” <a href={noteHref(row.source)}>{row.note}</a></p>{/if}
						{#if issues.get(row.id)}<p class="problem">{issues.get(row.id)}</p>{/if}
					</div>
				</div>
			{:else}
				<p class="empty">No term in this category.</p>
			{/each}
		</div>
	{/if}

	{#if plan.sources.length}
		<form class="add-row typed" onsubmit={addTyped}>
			<input class="field" bind:value={typed} maxlength={ENTRY_LIMITS.term} placeholder="A term the scan missed" aria-label="Add a term to the list" data-testid="scan-typed" />
			<button class="btn" disabled={!typed.trim()} data-testid="scan-typed-add">Add to list</button>
		</form>
	{/if}

	{#if rows.length}
		<div class="add">
			{#if asking && !asking.scan}
				<span data-testid="scan-discard-ask">Discard {plural(rows.length, 'term')}?</span>
				<button class="btn ghost small remove" onclick={discard} data-testid="scan-discard-confirm">Discard</button>
				<button class="btn ghost small" onclick={() => (asking = null)}>Keep</button>
			{:else}
				<button class="btn primary" onclick={add} disabled={adding || running || kept.length === 0 || issues.size > 0} data-testid="scan-add">
					{adding ? 'Adding…' : `Add ${plural(kept.length, 'term')}`}
				</button>
				<button class="btn ghost" onclick={() => (asking = { scan: false, all: false })} disabled={adding || running} data-testid="scan-discard">Discard</button>
				<span class="hint">
					{running ? 'Add once the scan is done, or stop it.' : issues.size ? 'Fix the marked terms, or untick them.' : `to ${path}`}
				</span>
			{/if}
		</div>
	{/if}
</section>

<style>
	.scan { display: flex; flex-direction: column; gap: var(--s3); margin-bottom: var(--s5); }
	.scan > :global(*) { margin-top: 0; margin-bottom: 0; }
	.go { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; font-size: var(--t14); }
	.left-out ul { margin: var(--s1) 0 0; padding-left: var(--s5); }
	.left-out li { margin-bottom: var(--s1); overflow-wrap: anywhere; }

	.found { display: flex; gap: var(--s3); align-items: flex-start; }
	.found .box { margin-top: 10px; }
	.found.off .fields { opacity: 0.5; }
	.fields { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--s1); }
	.line { display: flex; gap: var(--s2); flex-wrap: wrap; }
	.line .field { flex: 1 1 140px; width: auto; min-width: 0; }
	.line .term { flex: 2 1 200px; font-weight: 600; }
	.fields textarea { width: 100%; resize: vertical; font: inherit; }
	.why { display: flex; align-items: center; gap: var(--s2); }
	.why span { color: var(--accent); }
	.why .field { flex: 1; min-width: 0; }
	.quote { margin: 2px 0 0; font-size: var(--t13); color: var(--muted); padding-left: var(--s2); border-left: 2px solid var(--line); overflow-wrap: anywhere; }
	.fields .problem { margin: 0; }

	/* The button that writes stays in reach down a long list. */
	.add {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: var(--s3);
		flex-wrap: wrap;
		padding: var(--s3) 0;
		background: var(--bg);
		border-top: 1px solid var(--line);
		z-index: 1;
		font-size: var(--t14);
	}
	.add .hint { margin: 0; overflow-wrap: anywhere; }

	@media (max-width: 720px) {
		.go .btn:not(.small) { flex: 1 1 100%; min-height: 44px; }
		.add { padding-bottom: calc(var(--s3) + env(safe-area-inset-bottom)); }
		.add .btn.primary { flex: 1; min-height: 44px; }
	}
</style>

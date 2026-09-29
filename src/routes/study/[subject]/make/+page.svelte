<script lang="ts">
	/**
	 * Make cards: pick notes, let Claude draft flashcards from them, keep and
	 * edit the ones worth having, add them. One screen, top to bottom.
	 *
	 * Sources are notes and folders of the subject: a search box over its
	 * notes, the recently edited ones as chips, and a folder picker. Draft
	 * cards reads them in batches and appends what it drafts to the list
	 * below; Next batch reads on from where the last one stopped.
	 *
	 * Nothing is written until Add: the drafted cards are the model's
	 * proposal, the ticks and edits are the person's, and Add sends only the
	 * ticked cards, as edited, for the server to check and write into the
	 * subject's card file for the goal picked.
	 */
	import { draftCards } from '$lib/client/ai';
	import { addCards } from '$lib/client/study';
	import { noteHref } from '$lib/shared/links';
	import type { CardsAdded, DraftedCard, DroppedCard, SourceBatch } from '$lib/shared/study';

	let { data } = $props();

	const COUNTS = [5, 10, 20] as const;
	const base = $derived(`/study/${data.subject.slug}`);
	const titles = $derived(new Map(data.notes.map((n) => [n.path, n.title])));
	const titleOf = (path: string) => titles.get(path) ?? path.split('/').pop()!.replace(/\.md$/, '');
	/** A card file's path as the author knows it, under the subject's home. */
	const short = (path: string) => (path.startsWith(`${data.subject.home}/`) ? path.slice(data.subject.home.length + 1) : path);
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	/* ------------------------------------------------------------- sources -- */

	// Set once from the load, so `?note=` arrives picked and `?goal=` chosen.
	const initial = () => ({ notes: data.picked ? [data.picked] : [], goal: data.goal ?? '' });
	let notes = $state<string[]>(initial().notes);
	let folders = $state<string[]>([]);
	let query = $state('');

	const matches = $derived.by(() => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!terms.length) return [];
		return data.notes
			.filter((n) => !notes.includes(n.path) && terms.every((t) => `${n.title} ${n.path}`.toLowerCase().includes(t)))
			.slice(0, 8);
	});
	/** Every note the picks cover, folders expanded, as the server will read them. */
	const covered = $derived(
		new Set([...notes, ...data.notes.filter((n) => folders.some((f) => n.path.startsWith(`${f}/`))).map((n) => n.path)])
	);

	function toggleNote(path: string) {
		notes = notes.includes(path) ? notes.filter((p) => p !== path) : [...notes, path];
		restart();
	}
	function pickMatch(path: string) {
		toggleNote(path);
		query = '';
	}
	function addFolder(select: HTMLSelectElement) {
		if (select.value && !folders.includes(select.value)) folders = [...folders, select.value];
		select.value = '';
		restart();
	}
	function removeFolder(folder: string) {
		folders = folders.filter((f) => f !== folder);
		restart();
	}

	/* --------------------------------------------------------------- draft -- */

	let goal = $state(initial().goal);
	let count = $state<number>(10);
	/** Where the next batch starts; 0 once the picks change. */
	let from = $state(0);
	let batch = $state<SourceBatch | null>(null);
	let drafting = $state(false);
	let problem = $state('');

	type Row = DraftedCard & { id: number; keep: boolean };
	let rows = $state<Row[]>([]);
	let dropped = $state<DroppedCard[]>([]);
	let duplicates = $state<string[]>([]);
	let nextId = 0;

	const destination = $derived(data.destinations[goal] ?? data.destinations['']);

	/** The picks, the goal or the count changed: the next draft starts at the first note. */
	function restart() {
		from = 0;
		batch = null;
	}

	async function draft(start: number) {
		if (drafting || covered.size === 0) return;
		drafting = true;
		problem = '';
		added = null;
		const result = await draftCards({ subject: data.subject.slug, notes, folders, goal: goal || null, count, from: start });
		drafting = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		const value = result.value;
		batch = value.batch;
		from = value.batch?.next ?? 0;
		dropped = value.dropped;
		duplicates = value.duplicates;
		if (value.problem) problem = value.problem;
		const have = new Set(rows.map((r) => r.question.toLowerCase()));
		rows = [...rows, ...value.cards.filter((c) => !have.has(c.question.toLowerCase())).map((c) => ({ ...c, id: nextId++, keep: true }))];
	}

	/* ----------------------------------------------------------------- add -- */

	let adding = $state(false);
	let added = $state<CardsAdded | null>(null);

	const kept = $derived(rows.filter((r) => r.keep));
	const blank = $derived(kept.some((r) => !r.question.trim() || !r.answer.trim()));
	const rowsFor = (text: string) => Math.min(8, Math.max(1, text.split('\n').length, Math.ceil(text.length / 70)));

	function selectAll(keep: boolean) {
		for (const row of rows) row.keep = keep;
	}

	async function add() {
		if (adding || kept.length === 0 || blank) return;
		adding = true;
		problem = '';
		const result = await addCards(
			data.subject.slug,
			goal || null,
			kept.map((r) => ({ question: r.question, answer: r.answer, source: r.source }))
		);
		adding = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		added = result.value;
		rows = [];
		dropped = [];
		duplicates = [];
	}

	function more() {
		added = null;
		problem = '';
	}
</script>

<svelte:head><title>Make cards · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="{base}/flashcards">← {data.subject.name} flashcards</a>
		<h1>Make cards</h1>
		<p>Claude drafts flashcards from your notes. You choose and edit them; nothing is written until you add them.</p>
	</div>

	{#if !data.aiEnabled}
		<p class="callout" data-testid="ai-off"><b>AI is off.</b> Claude cannot draft cards until it is on. <a href="/settings">Turn it on in Settings</a>.</p>
	{/if}

	{#if added}
		<div class="callout done" data-testid="cards-added">
			<p>
				<b>Added {plural(added.added, 'card')}</b> to <span class="path">{short(added.path)}</span>.{#if added.skipped}
					{' '}{plural(added.skipped, 'card was', 'cards were')} already there.{/if}
			</p>
			<div class="actions">
				<a class="btn primary" href="{base}/review{added.goal ? `?goal=${added.goal.slug}` : ''}" data-testid="review-added">Review them now</a>
				<button class="btn" onclick={more} data-testid="make-more">Make more</button>
			</div>
		</div>
	{/if}

	<p class="label">From</p>
	<div class="sources">
		<div class="search">
			<input
				class="field"
				type="search"
				bind:value={query}
				placeholder="Search {data.subject.name}'s notes"
				aria-label="Search notes"
				data-testid="source-search"
				onkeydown={(e) => {
					if (e.key === 'Enter' && matches[0]) {
						e.preventDefault();
						pickMatch(matches[0].path);
					}
				}}
			/>
			{#if matches.length}
				<ul class="matches sheet" data-testid="source-matches">
					{#each matches as note (note.path)}
						<li>
							<button type="button" onclick={() => pickMatch(note.path)}>
								<span>{note.title}</span>
								<span class="path muted">{note.path}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if query.trim()}
				<p class="hint">No note of {data.subject.name}'s matches that.</p>
			{/if}
		</div>

		{#if data.recent.length}
			<div class="chips" data-testid="recent-notes">
				<span class="muted small">Recent</span>
				{#each data.recent as path (path)}
					<button type="button" class="chip" class:on={notes.includes(path)} aria-pressed={notes.includes(path)} onclick={() => toggleNote(path)}>{titleOf(path)}</button>
				{/each}
			</div>
		{/if}

		<div class="folder">
			<select class="field" onchange={(e) => addFolder(e.currentTarget)} aria-label="Add a folder" data-testid="source-folder">
				<option value="">Add a whole folder…</option>
				{#each data.folders as folder (folder)}
					<option value={folder} disabled={folders.includes(folder)}>{folder}</option>
				{/each}
			</select>
		</div>

		{#if notes.length || folders.length}
			<div class="chips picked" data-testid="picked">
				{#each notes as path (path)}
					<span class="chip on">{titleOf(path)}<button type="button" class="x" aria-label="Remove {titleOf(path)}" onclick={() => toggleNote(path)}>×</button></span>
				{/each}
				{#each folders as folder (folder)}
					<span class="chip on"><span class="path">{folder}/</span><button type="button" class="x" aria-label="Remove {folder}" onclick={() => removeFolder(folder)}>×</button></span>
				{/each}
			</div>
			<p class="hint" data-testid="picked-count">{plural(covered.size, 'note')} picked.</p>
		{:else if data.notes.length === 0}
			<p class="none">{data.subject.name} has no notes to make cards from yet.</p>
		{/if}
	</div>

	<div class="options">
		<label>
			<span class="muted small">Goal</span>
			<select class="field" bind:value={goal} onchange={restart} data-testid="make-goal">
				<option value="">No goal</option>
				{#each data.goals as g (g.slug)}<option value={g.name}>{g.name}</option>{/each}
			</select>
		</label>
		<div>
			<span class="muted small">How many</span>
			<div class="chips" role="group" aria-label="How many cards">
				{#each COUNTS as n (n)}
					<button type="button" class="chip" class:on={count === n} aria-pressed={count === n} onclick={() => (count = n)} data-testid="make-count">{n}</button>
				{/each}
			</div>
		</div>
		<button class="btn primary go" onclick={() => draft(0)} disabled={!data.aiEnabled || drafting || covered.size === 0} data-testid="draft-cards">
			{drafting ? 'Drafting…' : 'Draft cards'}
		</button>
	</div>
	<p class="hint" data-testid="make-destination">Cards go to <span class="path">{short(destination)}</span>, under a heading for each note, never into the notes.</p>

	{#if batch}
		<p class="hint batch" data-testid="make-batch">
			Read notes {batch.from + 1}–{batch.from + batch.read} of {batch.total}.
			{#if batch.next !== null}
				<button class="btn small" onclick={() => draft(batch!.next!)} disabled={drafting} data-testid="next-batch">Next batch</button>
			{/if}
		</p>
	{/if}
	{#if problem}<p class="problem" role="status" data-testid="make-problem">{problem}</p>{/if}
	{#if dropped.length}
		<details class="hint" data-testid="make-dropped">
			<summary>{plural(dropped.length, 'drafted card was', 'drafted cards were')} dropped, most often because the note does not say the answer.</summary>
			<ul>
				{#each dropped as d, i (i)}
					<li>
						{d.question}
						<span class="muted">({d.why === 'unwritable' ? 'cannot be written as a card' : `${titleOf(d.source)} does not say “${d.answer}”`})</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
	{#if duplicates.length}
		<p class="hint" data-testid="make-duplicates">{plural(duplicates.length, 'card was', 'cards were')} left out: {short(destination)} already asks {duplicates.length === 1 ? 'it' : 'them'}.</p>
	{/if}

	{#if rows.length}
		<p class="label">
			Drafted
			<span class="right">
				<button type="button" class="link" onclick={() => selectAll(true)} data-testid="select-all">Select all</button>
				·
				<button type="button" class="link" onclick={() => selectAll(false)} data-testid="select-none">None</button>
			</span>
		</p>
		<div class="sheet rows" data-testid="drafted-cards">
			{#each rows as row (row.id)}
				<div class="drafted" class:off={!row.keep} data-testid="drafted-card">
					<input type="checkbox" bind:checked={row.keep} aria-label="Keep this card" data-testid="keep-card" />
					<div class="sides">
						<textarea class="field front" bind:value={row.question} rows={rowsFor(row.question)} aria-label="Question" data-testid="card-front"></textarea>
						<textarea class="field back" bind:value={row.answer} rows={rowsFor(row.answer)} aria-label="Answer" data-testid="card-back"></textarea>
						<p class="quote small">“{row.quote}” <a href={noteHref(row.source)}>{row.note}</a></p>
					</div>
				</div>
			{/each}
		</div>
		<div class="add">
			<button class="btn primary" onclick={add} disabled={adding || kept.length === 0 || blank} data-testid="add-cards">
				{adding ? 'Adding…' : `Add ${plural(kept.length, 'card')}`}
			</button>
			<span class="hint">
				{blank ? 'A ticked card needs a question and an answer.' : `to ${short(destination)}`}
			</span>
		</div>
	{/if}
</div>

<style>
	.path { font-family: var(--mono); font-size: 0.92em; overflow-wrap: anywhere; }

	.done p { margin: 0 0 var(--s2); }
	.actions { display: flex; gap: var(--s2); flex-wrap: wrap; }

	.sources { display: flex; flex-direction: column; gap: var(--s3); }
	.search { position: relative; }
	.search .field { width: 100%; }
	.matches { list-style: none; margin: var(--s1) 0 0; padding: var(--s1); display: flex; flex-direction: column; }
	.matches button {
		width: 100%;
		display: flex;
		align-items: baseline;
		gap: var(--s3);
		padding: var(--s2);
		border: 0;
		background: none;
		border-radius: var(--r-sm);
		text-align: left;
		cursor: pointer;
		font: inherit;
		color: var(--text);
	}
	.matches button:hover,
	.matches button:focus-visible { background: var(--soft); }
	.matches .path { font-size: var(--t12); margin-left: auto; text-align: right; }
	.folder .field { width: 100%; }
	.picked .chip { display: inline-flex; align-items: center; gap: 4px; }
	.x { border: 0; background: none; color: inherit; font-size: var(--t15); line-height: 1; padding: 0 2px; cursor: pointer; }

	.options { display: flex; align-items: flex-end; gap: var(--s4); flex-wrap: wrap; margin-top: var(--s5); }
	.options label,
	.options > div { display: flex; flex-direction: column; gap: var(--s1); }
	.options select { min-width: 200px; }
	.options .go { margin-left: auto; }
	.batch { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	details ul { margin: var(--s1) 0 0; padding-left: var(--s5); }

	.link { border: 0; background: none; padding: 0; font: inherit; color: var(--accent); cursor: pointer; }
	.drafted { display: flex; gap: var(--s3); align-items: flex-start; }
	.drafted input[type='checkbox'] { margin-top: 10px; flex: none; }
	.drafted.off .sides { opacity: 0.5; }
	.sides { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--s1); }
	.sides textarea { width: 100%; resize: vertical; }
	.front { font-weight: 600; }
	.quote { margin: 2px 0 0; color: var(--muted); padding-left: var(--s2); border-left: 2px solid var(--line); overflow-wrap: anywhere; }

	/* The button that writes stays in reach down a list of twenty. */
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
		margin-top: var(--s3);
	}
	.add .hint { margin: 0; }

	@media (max-width: 720px) {
		.options { flex-direction: column; align-items: stretch; }
		.options select { min-width: 0; width: 100%; }
		.options .go { margin-left: 0; }
		.matches .path { display: none; }
		/* Above the bottom bar, which is fixed on a phone. */
		.add { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); }
		.add .btn { flex: 1; min-height: 44px; }
	}
</style>

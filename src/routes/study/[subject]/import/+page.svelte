<script lang="ts">
	/**
	 * The Anki import: every deck under `Flashcards/` and the card file it
	 * becomes, with a sample card, then one Import that writes the chosen files
	 * not there yet and a summary of what it did.
	 *
	 * Decks are grouped by their top folder under `Flashcards/` (Computer
	 * Science, Wisdom, …), because that is where they differ in subject. A group
	 * whose name matches one of this subject's folders starts ticked; the rest
	 * start unticked, so another subject's decks are not swept in by default.
	 */
	import { importAnkiDecks } from '$lib/client/study';
	import type { DeckImport, DeckStatus } from '$lib/shared/anki-import';

	let { data } = $props();

	/** What Import answered; until then the page shows the preview it loaded. */
	let imported = $state<DeckImport[] | null>(null);
	let busy = $state(false);
	let problem = $state('');

	const decks = $derived(imported ?? data.decks);
	const folder = $derived(data.home ? `${data.home}/Flashcards/` : 'Flashcards/');
	const withStatus = (status: DeckStatus) => decks.filter((d) => d.status === status);
	const cardsIn = (list: DeckImport[]) => list.reduce((sum, d) => sum + d.cards, 0);
	const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

	/** The top folder under `Flashcards/` a deck sits in; '' for a deck at its root. */
	const groupOf = (deck: DeckImport) => {
		const parts = deck.source.split('/');
		return parts.length > 2 ? parts[1] : '';
	};
	const groups = $derived([...new Set(decks.map(groupOf))]);
	const fresh = $derived(decks.filter((d) => d.status === 'new'));
	/** Set once, from the load: the groups named like this subject's own folders. */
	const defaults = () => data.decks.filter((d) => d.status === 'new' && data.own.includes(groupOf(d).toLowerCase())).map((d) => d.source);
	let chosen = $state<Set<string>>(new Set(defaults()));
	const inGroup = (group: string) => fresh.filter((d) => groupOf(d) === group);
	const allChosen = (group: string) => inGroup(group).length > 0 && inGroup(group).every((d) => chosen.has(d.source));
	function toggle(source: string) {
		const next = new Set(chosen);
		if (next.has(source)) next.delete(source);
		else next.add(source);
		chosen = next;
	}
	function toggleGroup(group: string) {
		const next = new Set(chosen);
		const on = !allChosen(group);
		for (const d of inGroup(group)) {
			if (on) next.add(d.source);
			else next.delete(d.source);
		}
		chosen = next;
	}
	const chosenCards = $derived(fresh.filter((d) => chosen.has(d.source)).reduce((sum, d) => sum + d.cards, 0));

	const LABEL: Record<DeckStatus, string> = { new: 'New', created: 'Created', exists: 'Already there', empty: 'No cards' };
	const TONE: Record<DeckStatus, string> = { new: '', created: 'ok', exists: 'muted', empty: 'warn' };

	async function run() {
		busy = true;
		problem = '';
		const result = await importAnkiDecks(data.subject.slug, [...chosen]);
		busy = false;
		if (result.ok) imported = result.value;
		else problem = result.message;
	}
</script>

<svelte:head><title>Import Anki decks · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/study/{data.subject.slug}/flashcards">← {data.subject.name} flashcards</a>
		<h1>Import Anki decks</h1>
		<p>Each deck under <span class="path">Flashcards/</span> becomes one card file in <span class="path">{folder}</span>.</p>
	</div>

	{#if decks.length === 0}
		<p class="none" data-testid="anki-none">There are no Anki decks under <span class="path">Flashcards/</span>.</p>
	{:else}
		{#if imported}
			{@const created = withStatus('created')}
			{@const skipped = withStatus('exists')}
			<p class="callout" data-testid="anki-summary">
				<b>Imported.</b>
				Created {plural(created.length, 'card file')} holding {plural(cardsIn(created), 'card')}.
				{#if skipped.length}Skipped {plural(skipped.length, 'deck')} whose file was already there.{/if}
				<a href="/study/{data.subject.slug}/flashcards">Go to Flashcards</a>
			</p>
		{:else}
			<div class="plan">
				<p data-testid="anki-plan">
					{plural(decks.length, 'deck')}, {plural(cardsIn(decks), 'card')}.
					{fresh.length} to create{#if withStatus('exists').length}, {withStatus('exists').length} already there{/if}.
					<b>{plural(chosen.size, 'deck')} chosen</b> ({plural(chosenCards, 'card')}).
				</p>
				<button class="btn primary" onclick={run} disabled={busy || chosen.size === 0} data-testid="anki-import">
					{busy ? 'Importing…' : `Import ${plural(chosen.size, 'deck')}`}
				</button>
			</div>
			{#if groups.length > 1}
				<div class="groups" data-testid="anki-groups">
					{#each groups as group (group)}
						{#if inGroup(group).length}
							<label class="chip" class:on={allChosen(group)}>
								<input type="checkbox" checked={allChosen(group)} onchange={() => toggleGroup(group)} />
								{group || 'Flashcards/'} <span class="muted">{inGroup(group).length}</span>
							</label>
						{/if}
					{/each}
				</div>
			{/if}
			<p class="hint">
				Nothing is written until you press Import. A file already there is never overwritten, and the
				<span class="path">.txt</span> decks are never changed. Review history starts fresh.
			</p>
		{/if}
		{#if problem}<p class="problem">{problem}</p>{/if}

		<div class="sheet rows decks">
			{#each decks as deck (deck.source)}
				<div class="deck" data-testid="anki-deck">
					<div class="head">
						{#if !imported && deck.status === 'new'}
							<input type="checkbox" checked={chosen.has(deck.source)} onchange={() => toggle(deck.source)} aria-label="Import {deck.deck}" data-testid="deck-choose" />
						{/if}
						<span class="name">{deck.deck}</span>
						<span class="num muted small" data-testid="deck-count">{plural(deck.cards, 'card')}</span>
						<span class="badge {TONE[deck.status]}" data-testid="deck-status">{LABEL[deck.status]}</span>
					</div>
					<p class="small muted"><span class="path">{deck.source}</span> → <span class="path" data-testid="deck-target">{deck.target}</span></p>
					{#if deck.sample}
						<div class="sample" data-testid="deck-sample">
							<div class="front">{deck.sample.front}</div>
							<div class="back">{deck.sample.back}</div>
						</div>
					{/if}
					{#each deck.problems as note, i (i)}<p class="problem">{note}</p>{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.path { font-family: var(--mono); font-size: 0.92em; overflow-wrap: anywhere; }

	.plan { display: flex; align-items: center; gap: var(--s4); justify-content: space-between; }
	.plan p { margin: 0; }
	.callout { margin: 0; }
	.decks { margin-top: var(--s5); }
	.groups { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
	.groups .chip { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

	.head { display: flex; align-items: baseline; gap: var(--s3); }
	.name { flex: 1; min-width: 0; font-weight: 500; }
	.deck p { margin: var(--s1) 0 0; }

	/* The sample shows the card as its file holds it, so line breaks stay. */
	.sample { margin-top: var(--s2); padding-left: var(--s3); border-left: 2px solid var(--line); font-size: var(--t14); }
	.front,
	.back { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; line-clamp: 4; -webkit-line-clamp: 4; overflow: hidden; }
	.front { font-weight: 500; }
	.back { color: var(--muted); margin-top: 2px; }

	@media (max-width: 720px) {
		.plan { flex-direction: column; align-items: stretch; }
	}
</style>

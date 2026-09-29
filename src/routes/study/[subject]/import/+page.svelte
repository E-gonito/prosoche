<script lang="ts">
	/**
	 * The Anki import: every deck under `Flashcards/` and the card file it
	 * becomes, with a sample card, then one Import that writes the files not
	 * there yet and a summary of what it did.
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

	const LABEL: Record<DeckStatus, string> = { new: 'New', created: 'Created', exists: 'Already there', empty: 'No cards' };
	const TONE: Record<DeckStatus, string> = { new: '', created: 'ok', exists: 'muted', empty: 'warn' };

	async function run() {
		busy = true;
		problem = '';
		const result = await importAnkiDecks(data.subject.slug);
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
			{@const fresh = withStatus('new')}
			<div class="plan">
				<p data-testid="anki-plan">
					{plural(decks.length, 'deck')}, {plural(cardsIn(decks), 'card')}.
					{fresh.length} to create{#if withStatus('exists').length}, {withStatus('exists').length} already there{/if}.
				</p>
				<button class="btn primary" onclick={run} disabled={busy || fresh.length === 0} data-testid="anki-import">
					{busy ? 'Importing…' : 'Import'}
				</button>
			</div>
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

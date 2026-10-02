<script lang="ts">
	/**
	 * The Flashcards page: one deck per glossary whose cards are on, each
	 * with its categories as links to a review of just that category,
	 * everything due across the decks, and the new cards a day they share.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';

	let { data } = $props();

	const ready = $derived(data.due + data.fresh);

	// Seeded once, like any form here: a reload mid-edit must not undo what is typed.
	// svelte-ignore state_referenced_locally
	let perDay = $state<number | null>(data.perDay);
	let saving = $state(false);
	let problem = $state('');

	async function savePerDay(event: Event) {
		event.preventDefault();
		if (perDay === null || saving) return;
		saving = true;
		problem = '';
		const result = await api<{ perDay: number }>('/api/flashcards/settings', { perDay });
		saving = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	const review = (deck: string, category?: string) =>
		`/flashcards/review?deck=${encodeURIComponent(deck)}${category ? `&category=${encodeURIComponent(category)}` : ''}`;
</script>

<svelte:head><title>Flashcards · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Flashcards</h1>
		<p>Every glossary whose terms are cards, reviewed both ways.</p>
	</div>

	<div class="due sheet">
		<span class="count num" data-testid="due-count">{ready}</span>
		<span class="muted">{ready === 1 ? 'card' : 'cards'} to review today{#if data.fresh}, {data.fresh} of them new{/if}</span>
		{#if ready > 0}<a class="btn primary" href="/flashcards/review" data-testid="review-all">Review all</a>{/if}
	</div>
	{#if data.held}
		<p class="hint" data-testid="held">
			{data.held} new {data.held === 1 ? 'card waits' : 'cards wait'} until the overdue reviews are done. Each one you catch up lets one in.
		</p>
	{/if}

	<form class="per-day" onsubmit={savePerDay} data-testid="new-per-day">
		<label for="per-day">New cards a day, shared between every deck</label>
		<input id="per-day" class="field num" type="number" min="0" max="500" step="1" bind:value={perDay} data-testid="per-day" />
		<button class="btn" disabled={perDay === null || perDay === data.perDay || saving}>{saving ? 'Saving…' : 'Save'}</button>
	</form>
	<p class="hint">Kept in <code>_hub/flashcards.md</code>. A glossary's own <code>new_per_day:</code> caps its share.</p>
	{#if problem}<p class="problem" role="status">{problem}</p>{/if}

	<p class="label">Decks</p>
	{#if data.decks.length === 0}
		<p class="empty">No glossary makes flashcards yet. Turn them on from a <a href="/glossary">glossary</a>'s page.</p>
	{:else}
		{#each data.decks as deck (deck.slug)}
			<section class="sheet deck" id="deck-{deck.slug}" data-testid="deck">
				<div class="head">
					<h2><i class="dot" style="--dot: {deck.color}"></i>{deck.name}</h2>
					<span class="num muted small">{deck.due} due · {deck.fresh} new · {deck.total} {deck.total === 1 ? 'card' : 'cards'}</span>
					<a class="small" href="/glossary/{deck.slug}">Glossary</a>
					{#if deck.due + deck.fresh > 0}<a class="btn" href={review(deck.slug)} data-testid="review-deck">Review</a>{/if}
				</div>
				{#if deck.categories.length}
					<nav class="categories" aria-label="{deck.name} categories" data-testid="deck-categories">
						{#each deck.categories as category (category.name)}
							<a class="chip" class:idle={category.ready === 0} href={review(deck.slug, category.name)} title="{category.cards} {category.cards === 1 ? 'card' : 'cards'}">
								{category.name}<span class="n num">{category.ready}</span>
							</a>
						{/each}
					</nav>
				{/if}
			</section>
		{/each}
	{/if}
</div>

<style>
	.due { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	/* The one figure on the page meant to be read at a glance. */
	.count { font-size: 34px; line-height: 1; font-weight: 600; }
	.due .btn { margin-left: auto; }
	.per-day { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; margin-top: var(--s3); font-size: var(--t13); }
	.per-day input { width: 5em; }
	.hint { margin-top: var(--s2); }

	.deck { display: flex; flex-direction: column; gap: var(--s3); margin-bottom: var(--s3); }
	.head { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.head h2 { margin: 0; display: flex; align-items: center; gap: var(--s2); font: 600 var(--t16) var(--serif); }
	.head .btn { margin-left: auto; }
	.categories { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: var(--t13);
		color: var(--text);
	}
	.chip:hover { border-color: var(--accent); text-decoration: none; }
	.chip .n { color: var(--muted); }
	.chip.idle { color: var(--muted); }
</style>

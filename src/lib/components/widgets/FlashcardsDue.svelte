<script lang="ts">
	/** Cards waiting, and the one button that matters: start reviewing. */
	import Unavailable from './Unavailable.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget }: { widget: LoadedWidget; refresh?: () => void } = $props();

	interface Data {
		on: string;
		due: number;
		fresh: number;
		total: number;
		waiting: number;
		decks: Array<{ deck: string; count: number }>;
		invisible: Array<{ path: string; title: string; cards: number }>;
		peek: Array<{ question: string; context: string }>;
		reviewHref: string;
	}
	const data = $derived(widget.data as Data | null);
</script>

{#if !data}
	<Unavailable {widget} />
{:else}
	<div data-testid="flashcards-due">
		<div class="top">
			<span class="count" data-testid="due-count">{data.waiting}</span>
			<span class="of">
				{data.due} due · {data.fresh} new
				<br /><span class="muted">of {data.total} in scope</span>
			</span>
			{#if data.waiting > 0}
				<a class="btn primary" href={data.reviewHref} data-testid="review-link">Review</a>
			{/if}
		</div>

		{#if data.decks.length > 0}
			<p class="decks">{#each data.decks.slice(0, 5) as deck (deck.deck)}<span class="tag">{deck.deck} {deck.count}</span>{/each}</p>
		{/if}

		{#if data.waiting === 0}
			<p class="none">Nothing due today.</p>
		{/if}

		{#each data.invisible as note (note.path)}
			<p class="warn" data-testid="invisible">
				<a href="/notes/{note.path}">{note.title}</a> has {note.cards}
				{note.cards === 1 ? 'card' : 'cards'} Obsidian cannot see. Add <code>#flashcards</code> to the note.
			</p>
		{/each}
	</div>
{/if}

<style>
	.top { display: flex; align-items: center; gap: 12px; }
	.count { font-size: 34px; line-height: 1; font-weight: 600; }
	.of { font-size: 12px; color: var(--muted); flex: 1; }
	.decks { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
	.none { margin: 10px 0 0; color: var(--muted); font-size: 13px; }
	.warn { margin: 10px 0 0; font-size: 12px; color: var(--warn); }
	.warn code { font: 11px var(--mono); background: var(--soft); padding: 1px 4px; border-radius: 4px; }
</style>

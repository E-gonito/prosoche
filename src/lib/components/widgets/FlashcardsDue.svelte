<script lang="ts">
	/** Cards waiting, and the one button that matters: start reviewing. */
	import Icon from '$lib/components/Icon.svelte';
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
			<p class="chips decks">{#each data.decks.slice(0, 5) as deck (deck.deck)}<span class="chip quiet num"><b>{deck.deck}</b> · {deck.count}</span>{/each}</p>
		{/if}

		{#if data.waiting === 0}
			<p class="none">Nothing due today.</p>
		{/if}

		{#each data.invisible as note (note.path)}
			<p class="warn" data-testid="invisible">
				<Icon name="alert-triangle" size={13} />
				<a href="/notes/{note.path}">{note.title}</a> has {note.cards} {note.cards === 1 ? 'card' : 'cards'} Obsidian cannot see — add <code>#flashcards</code>.
			</p>
		{/each}
	</div>
{/if}

<style>
	.top { display: flex; align-items: center; gap: var(--s3); }
	/* The one number the card exists for, so figures lined up. */
	.count { font-size: 34px; line-height: 1; font-weight: 600; font-variant-numeric: tabular-nums; }
	.of { font-size: var(--t12); color: var(--muted); flex: 1; }
	.decks { margin: 10px 0 0; }
	/* `.none` is shared, in app.css; only this widget needs the top margin,
	   because it always follows the `.top` row rather than starting the card. */
	.none { margin-top: 10px; }
	/*
	 * One sentence naming a note and the tag it is missing. On a 390px phone
	 * it does not fit on a line, and clipping it hid the tag — which is the
	 * only part that says what to do — so it wraps instead. `align-items` is
	 * baseline rather than centre so the icon sits on the first line of it.
	 */
	.warn {
		margin: 10px 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 5px;
		font-size: var(--t12);
		color: var(--warn);
		overflow-wrap: anywhere;
	}
	.warn :global(svg) { flex: none; align-self: center; }
	.warn code { font: var(--t11) var(--mono); background: var(--soft); padding: 1px var(--s1); border-radius: 4px; }
</style>

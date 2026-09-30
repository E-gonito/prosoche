<script lang="ts">
	/**
	 * A flashcard review: every deck, one deck, or one category of a deck.
	 * One card at a time, comfortable on a phone.
	 */
	import CardReview from '$lib/components/CardReview.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();

	const heading = $derived(data.deck ? (data.category ? `${data.deck.name}: ${data.category}` : data.deck.name) : 'Review');
	const lede = $derived(data.deck ? (data.category ? `The ${data.category} cards due today.` : 'This deck’s cards due today.') : 'Everything due today, from every deck.');
</script>

<svelte:head><title>{heading} · Flashcards · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/flashcards">Flashcards</a>
		<h1>{heading}</h1>
		<p>{lede}</p>
	</div>

	{#if data.cards.length === 0}
		<div class="empty big" data-testid="nothing-due">
			<p class="tick"><Icon name="check" size={40} /></p>
			<h2>Nothing due</h2>
			<p class="muted">{data.total > 0 ? `${data.total} cards here, none to review today.` : 'No cards here yet.'}</p>
			<a class="btn" href="/flashcards">Back to flashcards</a>
		</div>
	{:else}
		<CardReview cards={data.cards} today={data.today} />
	{/if}
</div>

<style>
	/*
	 * On a phone, `.page` is exactly the room `main` leaves under the shell
	 * header and its tab bar (see the height comment on `.session` in
	 * `CardReview.svelte`). `flex: 1` on whichever of the two states is
	 * showing is what turns that room into "the card scrolls, the grades sit
	 * on the floor" rather than the grades trailing wherever the content ends.
	 */
	@media (max-width: 720px) {
		.page { height: 100%; min-height: 0; display: flex; flex-direction: column; }
		.empty.big { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; }
		.page :global(.session) { flex: 1; min-height: 0; }
	}
</style>

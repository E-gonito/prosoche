<script lang="ts">
	/** A subject's review session, or one goal's. One card at a time, comfortable on a phone. */
	import CardReview from '$lib/components/CardReview.svelte';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
	const back = $derived(`/study/${data.subject.slug}/flashcards`);
</script>

<svelte:head><title>Review · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs subject={data.subject} lede={data.goal ? `Reviewing ${data.goal}.` : ''} />

	{#if data.cards.length === 0}
		<div class="empty big" data-testid="nothing-due">
			<p class="tick"><Icon name="check" size={40} /></p>
			<h2>Nothing due</h2>
			<p class="muted">
				{data.total > 0 ? `${data.total} cards here, none scheduled for today.` : 'No cards here yet.'}
			</p>
			<a class="btn" href={back}>Back to flashcards</a>
		</div>
	{:else}
		<CardReview cards={data.cards} today={data.today} {back} />
	{/if}
</div>

<style>
	.tick { display: flex; justify-content: center; color: var(--ok); margin: 0; }

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

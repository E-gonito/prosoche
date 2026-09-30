<script lang="ts">
	/** Everything due, across every subject. One card at a time, comfortable on a phone. */
	import CardReview from '$lib/components/CardReview.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Review · Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/study">Study</a>
		<h1>Review</h1>
		<p>Everything due today, from every subject.</p>
	</div>

	{#if data.cards.length === 0}
		<div class="empty big" data-testid="nothing-due">
			<p class="tick"><Icon name="check" size={40} /></p>
			<h2>Nothing due</h2>
			<p class="muted">
				{data.total > 0 ? `${data.total} cards across your subjects, none scheduled for today.` : 'No cards yet.'}
			</p>
			<a class="btn" href="/study">Back to study</a>
		</div>
	{:else}
		<CardReview cards={data.cards} today={data.today} />
	{/if}
</div>

<style>
	/* See the same rule in `study/[subject]/review/+page.svelte`. */
	@media (max-width: 720px) {
		.page { height: 100%; min-height: 0; display: flex; flex-direction: column; }
		.empty.big { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; }
		.page :global(.session) { flex: 1; min-height: 0; }
	}
</style>

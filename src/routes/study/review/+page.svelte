<script lang="ts">
	/** The review session. One card at a time, comfortable on a phone. */
	import CardReview from '$lib/components/CardReview.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Review · prosoche</title></svelte:head>

<PageHeader
	title="Review cards"
	back={{ href: `/study${data.workspace ? `?ws=${data.workspace.slug}` : ''}`, label: '‹ Study' }}
>
	{#snippet meta()}
		<span>{data.workspace?.name ?? 'Whole vault'}</span>
	{/snippet}
</PageHeader>

{#if data.cards.length === 0}
	<div class="empty" data-testid="nothing-due">
		<p class="tick">✓</p>
		<h2>Nothing due</h2>
		<p class="muted">
			{data.total > 0 ? `${data.total} cards in scope, none scheduled for today.` : 'No cards here yet.'}
		</p>
		<a class="btn" href="/study">Back to study</a>
	</div>
{:else}
	<CardReview cards={data.cards} today={data.today} />
{/if}

<style>
	.empty { text-align: center; padding: 60px 16px; }
	.tick { font-size: 44px; color: var(--ok); margin: 0; }
	.empty h2 { margin: 8px 0; font-size: 20px; }
	.empty .muted { margin-bottom: 18px; }
</style>

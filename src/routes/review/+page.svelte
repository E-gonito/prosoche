<script lang="ts">
	/**
	 * The queue of proposals, each with its diff and its own decision.
	 *
	 * Nothing is batched. There is no "accept all" across proposals, because
	 * the two things that land here — a note created from a week's figures, a
	 * heading added to today's note — are different enough decisions that one
	 * button for both would be a button people press without reading.
	 */
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Proposal from '$lib/components/Proposal.svelte';
	import { applyProposal, dismissProposal } from '$lib/client/ai';

	let { data } = $props();

	let busy = $state<string | null>(null);
	let problem = $state('');
	let done = $state<Record<string, string>>({});

	async function accept(id: string, ids: string[]) {
		const item = data.items.find((i) => i.proposal.id === id);
		if (!item || busy) return;
		busy = id;
		problem = '';
		const result = await applyProposal(item.proposal, ids);
		if (result.ok && result.value.written.length) {
			await dismissProposal(id);
			done = { ...done, [id]: `Written to ${result.value.written.join(', ')}.` };
			await invalidateAll();
		} else if (result.ok) {
			problem = result.value.refusals[0]?.message ?? 'Nothing was written.';
		} else {
			problem = result.message;
		}
		busy = null;
	}

	async function reject(id: string) {
		if (busy) return;
		busy = id;
		problem = '';
		const result = await dismissProposal(id);
		busy = null;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}
</script>

<svelte:head><title>Review · prosoche</title></svelte:head>

<PageHeader title="Review" />
<p class="lead">Changes the app has drafted and not made.</p>

{#if !data.enabled}
	<div class="card">
		<EmptyState
			icon="sparkles"
			title="AI is switched off, so nothing new will arrive here."
			hint="Anything already waiting can still be accepted or dismissed."
		>
			{#snippet action()}
				<a class="btn ghost" href="/settings/ai">Go to Settings → AI</a>
			{/snippet}
		</EmptyState>
	</div>
{/if}

{#if problem}<p class="problem">{problem}</p>{/if}

{#each data.items as item (item.proposal.id)}
	<article class="item" data-testid="review-item">
		<p class="what">
			<b>{item.label}</b>
			<span class="muted">{item.proposal.summary}</span>
			<span class="when">{item.proposal.stamp.startedAt.slice(0, 16).replace('T', ' ')}</span>
		</p>
		{#if done[item.proposal.id]}
			<p class="ok">{done[item.proposal.id]}</p>
		{:else}
			<Proposal
				proposal={item.proposal}
				validation={item.validation}
				busy={busy === item.proposal.id}
				onaccept={(ids) => accept(item.proposal.id, ids)}
				onreject={() => reject(item.proposal.id)}
			/>
		{/if}
	</article>
{:else}
	<div class="card">
		<EmptyState
			testid="review-empty"
			icon="check"
			title="Nothing is waiting."
			hint="The briefing and the weekly review land here on their own schedule."
		/>
	</div>
{/each}

<style>
	.lead { margin: -8px 0 16px; max-width: 70ch; color: var(--muted); font-size: 13px; }
	.item { margin-bottom: 18px; }
	.what { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0 0 6px; font-size: 13px; }
	.what .muted { color: var(--muted); }
	.when { margin-left: auto; font: 11px var(--mono); color: var(--muted); }
	.ok { margin: 0; font-size: 13px; color: var(--ok); }
	.problem { margin: 0 0 12px; font-size: 13px; color: var(--bad); }
</style>

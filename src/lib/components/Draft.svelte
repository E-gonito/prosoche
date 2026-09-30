<script lang="ts">
	/**
	 * A button that drafts a change, and the proposal it produces.
	 *
	 * A drafting feature (today, a glossary's look-ups) reads what it needs and
	 * then a proposal arrives, the guardrails are re-run against the note as it
	 * is now, the user ticks what they want, and the ticked edits are written.
	 * That shared half is here, so no surface has its own slightly different
	 * idea of what accepting means.
	 *
	 * Nothing happens until the button is pressed, and the proposal is
	 * discarded when the user rejects it. A draft is not queued: these run
	 * with the user watching, and something waiting on the review page that
	 * they have already seen and dismissed would be noise.
	 */
	import Proposal from '$lib/components/Proposal.svelte';
	import { api } from '$lib/client/api';
	import type { ApplyResult, DraftResult, Proposal as P, Validation } from '$lib/shared/ai';

	let {
		endpoint,
		request,
		label,
		title = '',
		ondone
	}: {
		/** The drafting route, e.g. `/api/glossary/lookup`, which answers a `DraftResult`. */
		endpoint: string;
		/** What to draft. Passed to the endpoint as written. */
		request: Record<string, unknown>;
		label: string;
		title?: string;
		/** Smaller button, for a widget row rather than a page. */
		/** Called with the paths written, so the page can reload them. */
		ondone?: (written: string[]) => void;
	} = $props();

	let busy = $state(false);
	let drafted = $state<DraftResult | null>(null);
	let validation = $state<Validation | null>(null);
	let problem = $state('');
	let written = $state<string[]>([]);

	async function start() {
		if (busy) return;
		busy = true;
		problem = '';
		written = [];
		drafted = null;
		validation = null;

		// Read-only: nothing is written until the proposal is accepted below.
		const result = await api<DraftResult>(endpoint, request);
		if (!result.ok) {
			problem = result.message;
			busy = false;
			return;
		}
		drafted = result.value;
		problem = result.value.problem ?? '';

		if (result.value.proposal) {
			const checked = await api<{ validation: Validation }>('/api/ai/proposal', {
				action: 'validate',
				proposal: result.value.proposal,
				destinations: result.value.destinations
			});
			if (checked.ok) validation = checked.value.validation;
			else problem = checked.message;
		}
		busy = false;
	}

	async function accept(proposal: P, ids: string[]) {
		if (busy) return;
		busy = true;
		const answer = await api<{ result: ApplyResult }>('/api/ai/proposal', {
			action: 'apply',
			proposal,
			accepted: ids,
			destinations: drafted?.destinations ?? []
		});
		busy = false;
		if (!answer.ok) {
			problem = answer.message;
			return;
		}
		const result = answer.value.result;
		if (result.written.length === 0) {
			problem = result.refusals[0]?.message ?? 'Nothing was written.';
			return;
		}
		written = result.written;
		drafted = null;
		validation = null;
		ondone?.(written);
	}

	function reject() {
		drafted = null;
		validation = null;
		problem = '';
	}
</script>

<div class="draft">
	<button class="btn go" onclick={start} disabled={busy} {title} data-testid="draft-run">
		{busy ? 'Working…' : label}
	</button>

	{#if written.length}
		<p class="ok" data-testid="draft-written">Written to {written.join(', ')}.</p>
	{/if}

	{#if drafted?.proposal && validation}
		<Proposal
			proposal={drafted.proposal}
			{validation}
			{busy}
			onaccept={(ids) => accept(drafted!.proposal!, ids)}
			onreject={reject}
		/>
	{/if}

	{#if problem}<p class="problem" data-testid="draft-problem">{problem}</p>{/if}
</div>

<style>
	/* An ordinary `.btn`, with the two differences this one has: it says when
	   it is working. */
	.go:disabled { cursor: default; opacity: 0.6; }
	.ok { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--ok); }
</style>

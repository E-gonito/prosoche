<script lang="ts">
	/**
	 * A button that drafts a change, and the proposal it produces.
	 *
	 * The drafting features — file this capture, the meeting notebook's
	 * primer and prep, a glossary's look-ups — differ in what
	 * they read and agree on everything after that: a proposal arrives, the
	 * guardrails are re-run against the note as it is now, the user ticks what
	 * they want, and the ticked edits are written. That shared half is here,
	 * so none of the surfaces has its own slightly different idea of what
	 * accepting means.
	 *
	 * Nothing happens until the button is pressed, and the proposal is
	 * discarded when the user rejects it. A draft is not queued: these run
	 * with the user watching, and something waiting on the review page that
	 * they have already seen and dismissed would be noise.
	 */
	import Proposal from '$lib/components/Proposal.svelte';
	import { applyProposal, checkProposal, draftChange, type Drafted } from '$lib/client/ai';
	import type { Proposal as P, Validation } from '$lib/shared/ai';

	let {
		request,
		label,
		title = '',
		ondone
	}: {
		/** What to draft. Passed to the endpoint as written. */
		request: Parameters<typeof draftChange>[0];
		label: string;
		title?: string;
		/** Smaller button, for a widget row rather than a page. */
		/** Called with the paths written, so the page can reload them. */
		ondone?: (written: string[]) => void;
	} = $props();

	let busy = $state(false);
	let drafted = $state<Drafted | null>(null);
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

		const result = await draftChange(request);
		if (!result.ok) {
			problem = result.message;
			busy = false;
			return;
		}
		drafted = result.value;
		problem = result.value.problem ?? '';

		if (result.value.proposal) {
			const checked = await checkProposal(result.value.proposal, result.value.destinations);
			if (checked.ok) validation = checked.value;
			else problem = checked.message;
		}
		busy = false;
	}

	async function accept(proposal: P, ids: string[]) {
		if (busy) return;
		busy = true;
		const result = await applyProposal(proposal, ids, drafted?.destinations ?? []);
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		if (result.value.written.length === 0) {
			problem = result.value.refusals[0]?.message ?? 'Nothing was written.';
			return;
		}
		written = result.value.written;
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

	{#if drafted?.candidates?.length === 0}
		<p class="hint">There is nowhere to file this yet. Give a workspace some folders first.</p>
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
	.hint { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--muted); }
	.ok { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--ok); }
	.problem { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--bad); }
</style>

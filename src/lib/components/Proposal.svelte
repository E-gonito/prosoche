<script lang="ts">
	/**
	 * A proposal, as something to read and decide about.
	 *
	 * This component is the human half of guardrail G1. Everything else in the
	 * AI layer exists to make sure nothing is written without a click; this is
	 * the click. So the design rule is that nothing here is persuasive: the
	 * diff is the whole diff, the reason is the model's own words, refusals are
	 * shown plainly with the guardrail that fired, and Reject is as easy to
	 * reach as Accept.
	 *
	 * Per-edit accept, rather than all or nothing, because a review whose only
	 * options are everything and nothing pushes people into taking the one
	 * wrong line along with the four right ones. An edit that a guardrail
	 * refused cannot be ticked at all.
	 */
	import { diffLines, type EditPreview, type Proposal, type Refusal, type Validation } from '$lib/shared/ai';
	import { EDIT_KIND_LABELS } from '$lib/shared/ai';

	let {
		proposal,
		validation,
		busy = false,
		onaccept,
		onreject,
		onedit
	}: {
		proposal: Proposal;
		validation: Validation;
		busy?: boolean;
		/** Called with the edit ids the user ticked. */
		onaccept: (ids: string[]) => void;
		onreject: () => void;
		/** Called when the user wants to change an edit's text before accepting. */
		onedit?: (id: string, text: string) => void;
	} = $props();

	const previews = $derived(validation.previews);
	const blocked = $derived(validation.ok ? [] : validation.refusals.filter((r) => r.path === undefined));

	const allowed = $derived(previews.filter((p) => p.refusals.length === 0).map((p) => p.id));
	let ticked = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let draft = $state('');

	// Start with every applicable edit ticked: the common case is accepting the
	// lot, and an empty list reads as if nothing were on offer.
	$effect(() => {
		ticked = allowed;
	});

	const toggle = (id: string) => {
		ticked = ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id];
	};

	function startEdit(preview: EditPreview) {
		editing = preview.id;
		draft = preview.after;
	}
	function saveEdit(id: string) {
		onedit?.(id, draft);
		editing = null;
	}

	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
	const rows = (preview: EditPreview) => diffLines(preview.before, preview.after);
	const counts = (preview: EditPreview) => {
		const r = rows(preview);
		return { added: r.filter((x) => x.kind === 'add').length, removed: r.filter((x) => x.kind === 'remove').length };
	};
</script>

{#snippet refusalList(items: Refusal[], testid: string)}
	<ul class="refusals" data-testid={testid}>
		{#each items as refusal, i (i)}
			<li>
				<span class="badge">{refusal.guardrail}</span>
				<b>{refusal.title}</b>
				<span>{refusal.message}</span>
			</li>
		{/each}
	</ul>
{/snippet}

<section class="proposal card" data-testid="proposal">
	<h3>
		Proposed changes
		<span class="right muted">
			{proposal.stamp.model} · {proposal.stamp.effort} · {proposal.stamp.permission}
		</span>
	</h3>

	<p class="summary" data-testid="proposal-summary">{proposal.summary}</p>

	{#if blocked.length}
		<div class="stopped" data-testid="proposal-blocked">
			<b>Nothing was applied.</b> This proposal was stopped before it reached your notes.
			{@render refusalList(blocked, 'proposal-refusals')}
		</div>
	{/if}

	{#each previews as preview (preview.id)}
		{@const refused = preview.refusals.length > 0}
		{@const n = counts(preview)}
		<article class="edit" class:refused data-testid="proposal-edit" data-edit-id={preview.id}>
			<header>
				<label class="tick">
					<input
						type="checkbox"
						checked={ticked.includes(preview.id)}
						disabled={refused || busy}
						onchange={() => toggle(preview.id)}
						data-testid="accept-edit"
						aria-label="Accept this change to {preview.path}"
					/>
					<span class="kind">{EDIT_KIND_LABELS[preview.kind]}</span>
				</label>
				<a class="path" href={href(preview.path)}>{preview.path}</a>
				{#if preview.to}<span class="muted">→ {preview.to}</span>{/if}
				<span class="counts muted">+{n.added} −{n.removed}</span>
			</header>

			<p class="reason">{preview.reason}</p>

			{#if refused}
				{@render refusalList(preview.refusals, 'edit-refusals')}
			{/if}

			{#if editing === preview.id}
				<textarea bind:value={draft} rows="12" data-testid="edit-text" aria-label="Edit the proposed text"></textarea>
				<div class="row">
					<button class="btn primary" onclick={() => saveEdit(preview.id)} data-testid="save-edit">Save</button>
					<button class="btn" onclick={() => (editing = null)}>Cancel</button>
				</div>
			{:else}
				<pre class="diff" data-testid="edit-diff">{#each rows(preview) as row, i (i)}<span
							class="line {row.kind}">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : ' '}{row.text}
</span>{/each}</pre>
				{#if onedit && !refused}
					<button class="btn ghost small" onclick={() => startEdit(preview)} data-testid="edit-before-accept">
						Edit before accepting
					</button>
				{/if}
			{/if}
		</article>
	{/each}

	<footer>
		<button
			class="btn primary"
			disabled={busy || ticked.length === 0}
			onclick={() => onaccept(ticked)}
			data-testid="accept-proposal"
		>
			{ticked.length === previews.length ? 'Accept all' : `Accept ${ticked.length}`}
		</button>
		<button class="btn" disabled={busy} onclick={onreject} data-testid="reject-proposal">Reject</button>
		<span class="muted note">Nothing is written until you accept; a snapshot is kept either way.</span>
	</footer>
</section>

<style>
	.proposal { margin-top: 14px; }
	.summary { margin: 0 0 12px; }
	.stopped {
		border: 1px solid var(--bad);
		background: #fef2f2;
		border-radius: 8px;
		padding: 10px 12px;
		margin-bottom: 12px;
		font-size: 13px;
	}
	.refusals { list-style: none; margin: 6px 0 0; padding: 0; font-size: 12px; }
	.refusals li { display: flex; gap: 6px; align-items: baseline; padding: 2px 0; flex-wrap: wrap; }
	.badge {
		font: 11px var(--mono);
		font-weight: 700;
		background: var(--bad);
		color: #fff;
		border-radius: 4px;
		padding: 1px 5px;
	}
	.edit { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
	.edit.refused { border-color: var(--bad); background: #fffafa; }
	header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.tick { display: flex; align-items: center; gap: 6px; }
	.kind { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	.path { font: 12px var(--mono); }
	.counts { margin-left: auto; font: 11px var(--mono); }
	.reason { margin: 6px 0; font-size: 13px; color: var(--muted); }
	.diff {
		margin: 6px 0 0;
		max-height: 360px;
		overflow: auto;
		background: var(--soft);
		border-radius: 6px;
		padding: 8px 10px;
		font: 12px/1.5 var(--mono);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.line { display: block; }
	.line.add { background: #e7f6ec; }
	.line.remove { background: #fdecea; }
	textarea {
		width: 100%;
		font: 12px/1.5 var(--mono);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 8px;
		margin-top: 6px;
	}
	.row { display: flex; gap: 8px; margin-top: 8px; }
	.small { font-size: 12px; padding: 3px 8px; margin-top: 6px; }
	footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
	.note { font-size: 12px; }
</style>

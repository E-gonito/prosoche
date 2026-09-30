<script lang="ts">
	/**
	 * The morning briefing: a read on today and the rest of the week, on
	 * request, written only once you say so.
	 *
	 * The text on screen is the note's own briefing region, read like any
	 * other text — that is also why there is no loading state for the usual
	 * case: by the time the page renders, the briefing either is in the note
	 * or is not. Pressing "Brief me" drafts a fresh one and shows it as a
	 * preview with **Save to note** and **Discard**; nothing reaches the vault
	 * until Save is pressed, which is `Draft.svelte`'s own rule applied here
	 * by hand rather than through that component, because a briefing reads
	 * better as prose than as a diff.
	 *
	 * A strip above the timeline rather than a card beside it, and one that
	 * folds away: the briefing is read once in the morning and is in the way
	 * for the rest of the day. Folded or not is remembered per device. It
	 * draws nothing at all on a day that has neither a briefing nor any
	 * prospect of one, because a permanent "nothing was written for this day"
	 * is noise on every day but one.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import Icon from '$lib/components/Icon.svelte';
	import type { ApplyResult, DraftResult, Proposal, Validation } from '$lib/shared/ai';

	let {
		day,
		text,
		isToday,
		aiEnabled
	}: {
		day: string;
		/** The note's own briefing region, or null when it has none. */
		text: string | null;
		isToday: boolean;
		aiEnabled: boolean;
	} = $props();

	let busy = $state(false);
	let problem = $state('');
	let drafted = $state<{ body: string; addsMarkersOnly: boolean; destinations: string[] } | null>(null);
	let proposalRef = $state<Proposal | null>(null);
	let justAddedMarkers = $state(false);

	let collapsed = $state(false);
	// Read after mounting, because the server has no idea what this device
	// last chose and rendering the guess would make the strip jump.
	$effect(() => {
		collapsed = localStorage.getItem('hub:briefing-collapsed') === '1';
	});
	function fold() {
		collapsed = !collapsed;
		localStorage.setItem('hub:briefing-collapsed', collapsed ? '1' : '0');
	}

	// A fresh draft or a problem is not something to hide behind a fold.
	const open = $derived(!collapsed || Boolean(problem) || drafted !== null);
	/** Paragraphs and bullets, which is all `render` ever emits. */
	const blocks = (body: string) =>
		body
			.split(/\n{2,}/)
			.map((block) => block.split('\n').filter(Boolean))
			.filter((lines) => lines.length > 0);
	const existingBlocks = $derived(blocks(text ?? ''));
	const draftBlocks = $derived(drafted ? blocks(drafted.body) : []);
	/** What the strip says about itself while it is folded: its first line. */
	const gist = $derived(existingBlocks[0]?.[0] ? item(existingBlocks[0][0].replace(/\*\*/g, '')) : '');

	async function brief() {
		if (busy) return;
		busy = true;
		problem = '';
		justAddedMarkers = false;
		drafted = null;

		// Read-only: nothing is written until the proposal is accepted by Save.
		const result = await api<DraftResult>('/api/ai/briefing', { day });
		if (!result.ok) {
			problem = result.message;
			busy = false;
			return;
		}
		if (result.value.problem) problem = result.value.problem;

		const proposal = result.value.proposal;
		if (proposal) {
			const edit = proposal.edits[0];
			const checked = await api<{ validation: Validation }>('/api/ai/proposal', { action: 'validate', proposal, destinations: result.value.destinations });
			if (checked.ok) {
				proposalRef = proposal;
				drafted = {
					body: edit.kind === 'replace-region' ? edit.text : '',
					addsMarkersOnly: edit.kind === 'append',
					destinations: result.value.destinations
				};
			} else {
				problem = checked.message;
			}
		}
		busy = false;
	}

	async function save() {
		if (busy || !proposalRef || !drafted) return;
		busy = true;
		const accepted = proposalRef.edits.map((e) => e.id);
		const result = await api<{ result: ApplyResult }>('/api/ai/proposal', { action: 'apply', proposal: proposalRef, accepted, destinations: drafted.destinations });
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		if (result.value.result.written.length === 0) {
			problem = result.value.result.refusals[0]?.message ?? 'Nothing was written.';
			return;
		}
		justAddedMarkers = drafted.addsMarkersOnly;
		drafted = null;
		proposalRef = null;
		await invalidateAll();
	}

	function discard() {
		drafted = null;
		proposalRef = null;
		problem = '';
	}

	/** `**Scheduled**` is the only markup `render` emits at the head of a block. */
	function heading(line: string): string | null {
		const m = /^\*\*(.+)\*\*$/.exec(line.trim());
		return m ? m[1] : null;
	}

	/** Strip the leading `- ` and the wikilink brackets, which do not link here. */
	function item(line: string): string {
		return line.replace(/^[-*]\s+/, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, p, a) => a ?? p.split('/').pop());
	}
</script>

{#snippet blockList(list: string[][])}
	{#each list as lines, i (i)}
		{@const head = heading(lines[0])}
		{#if head}
			<p class="caps section-label">{head}</p>
			<ul>
				{#each lines.slice(1) as line, j (j)}<li>{item(line)}</li>{/each}
			</ul>
		{:else}
			<p class="prose">{lines.join(' ')}</p>
		{/if}
	{/each}
{/snippet}

{#if isToday || text}
	<section class="card strip" data-testid="briefing">
		<div class="bar">
			<button
				class="icon-btn fold"
				data-testid="briefing-fold"
				aria-expanded={open}
				aria-label={open ? 'Hide the briefing' : 'Show the briefing'}
				onclick={fold}
			>
				<Icon name={open ? 'chevron-down' : 'chevron-right'} />
				<span class="name">Briefing</span>
			</button>
			{#if !open && gist}<span class="gist">{gist}</span>{/if}
			{#if isToday && aiEnabled}
				<button class="btn small regen" onclick={brief} disabled={busy} data-testid="briefing-brief">
					{busy ? 'Thinking…' : text ? 'Brief me again' : 'Brief me'}
				</button>
			{/if}
		</div>

		{#if open}
			{#if drafted}
				<div class="draft" data-testid="briefing-draft">
					{#if drafted.addsMarkersOnly}
						<p class="hint">
							Today's note has no briefing section yet. Saving adds it; press Brief me again afterwards to fill it in.
						</p>
					{:else}
						{@render blockList(draftBlocks)}
					{/if}
					<div class="row">
						<button class="btn primary" onclick={save} disabled={busy} data-testid="briefing-save">
							{busy ? 'Saving…' : 'Save to note'}
						</button>
						<button class="btn" onclick={discard} disabled={busy} data-testid="briefing-discard">Discard</button>
					</div>
				</div>
			{:else if existingBlocks.length}
				{@render blockList(existingBlocks)}
			{:else if !aiEnabled}
				<p class="hint">AI is off, so there is no briefing to draft. <a href="/settings">Turn it on in Settings</a>.</p>
			{:else if !problem}
				<p class="hint">
					{#if isToday}
						No briefing yet today. Press Brief me for a read on today and the rest of the week.
					{:else}
						Nothing was written for this day.
					{/if}
				</p>
			{/if}

			{#if justAddedMarkers}
				<p class="hint">Added the briefing section. Press Brief me again to fill it in.</p>
			{/if}
		{/if}
		{#if problem}<p class="problem" data-testid="briefing-problem">{problem}</p>{/if}
	</section>
{/if}

<style>
	.strip { padding: var(--s2) var(--s3); }
	.bar { display: flex; align-items: center; gap: 10px; min-width: 0; }
	/* An `.icon-btn` that carries its own label, so it reads as the card's
	   heading rather than as a control sitting next to one. */
	.fold {
		gap: 6px;
		padding: 2px var(--s1);
		font-size: var(--t12);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.name { font-weight: 600; }
	/* The first line of the briefing, so the fold still says something. */
	.gist {
		flex: 1;
		min-width: 0;
		font-size: var(--t13);
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.regen { margin-left: auto; flex: none; }
	.regen:disabled { cursor: default; opacity: 0.6; }
	.prose { margin: 0 0 10px; font-size: var(--t13); line-height: 1.5; }
	.section-label { margin: 0 0 var(--s1); }
	ul { margin: 0 0 10px; padding-left: 18px; font-size: var(--t13); line-height: 1.5; }
	li { margin: 0 0 2px; }
	.draft { border-top: 1px dashed var(--line); padding-top: var(--s2); margin-top: var(--s1); }
	.row { display: flex; gap: var(--s2); margin-top: var(--s1); }
</style>

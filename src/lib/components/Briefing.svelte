<script lang="ts">
	/**
	 * The morning briefing, as it stands in today's note.
	 *
	 * The text is read out of the note rather than held anywhere else, so what
	 * this card shows and what Obsidian shows are the same characters. That is
	 * also why there is no loading state for the usual case: by the time the
	 * page renders, the briefing either is in the note or is not.
	 *
	 * Regenerating is a button rather than something that happens on arrival.
	 * A card that quietly spends money every time a page is opened is the kind
	 * of thing you find out about from a bill.
	 */
	import { regenerateBriefing } from '$lib/client/ai';
	import type { BriefingRun } from '$lib/shared/ai';

	let {
		day,
		text,
		isToday
	}: {
		day: string;
		text: string | null;
		isToday: boolean;
	} = $props();

	let busy = $state(false);
	let run = $state<BriefingRun | null>(null);

	// The note is the source of truth, and a regenerate supersedes it only for
	// the day it was asked about. Derived rather than copied, so navigating to
	// yesterday cannot leave today's briefing on screen.
	const fresh = $derived(run?.day === day ? run : null);
	const current = $derived(fresh ? fresh.text : text);
	const problem = $derived(fresh?.problem ?? '');
	// A note with no markers gets a proposal instead of a write.
	const needsAccept = $derived(fresh?.proposal != null);

	/** Paragraphs and bullets, which is all `render` ever emits. */
	const blocks = $derived(
		(current ?? '')
			.split(/\n{2,}/)
			.map((block) => block.split('\n').filter(Boolean))
			.filter((lines) => lines.length > 0)
	);

	let failure = $state('');

	async function regenerate() {
		if (busy) return;
		busy = true;
		failure = '';
		const result = await regenerateBriefing(day);
		busy = false;
		if (result.ok) run = result.value;
		else failure = result.message;
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

<div class="card" data-testid="briefing">
	<h3>
		Briefing
		{#if isToday}
			<button class="right regen" onclick={regenerate} disabled={busy} data-testid="briefing-regenerate">
				{busy ? 'Thinking…' : current ? 'Regenerate' : 'Generate'}
			</button>
		{/if}
	</h3>

	{#if blocks.length}
		{#each blocks as lines, i (i)}
			{@const head = heading(lines[0])}
			{#if head}
				<p class="label">{head}</p>
				<ul>
					{#each lines.slice(1) as line, j (j)}<li>{item(line)}</li>{/each}
				</ul>
			{:else}
				<p class="prose">{lines.join(' ')}</p>
			{/if}
		{/each}
	{:else if !problem && !failure}
		<p class="hint">
			{#if isToday}
				No briefing yet today. It runs on its own at 07:00, or press Generate.
			{:else}
				Nothing was written for this day.
			{/if}
		</p>
	{/if}

	{#if needsAccept}
		<p class="hint">
			This note has no briefing markers yet. Adding them changes your note, so it waits for you on the
			<a href="/review">review page</a>.
		</p>
	{/if}
	{#if problem || failure}<p class="problem">{problem || failure}</p>{/if}
</div>

<style>
	h3 { display: flex; align-items: center; gap: 8px; }
	.regen {
		margin-left: auto;
		border: 1px solid var(--line);
		background: var(--panel);
		border-radius: 6px;
		padding: 2px 8px;
		font: inherit;
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--muted);
		cursor: pointer;
	}
	.regen:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
	.regen:disabled { cursor: default; opacity: 0.6; }
	.prose { margin: 0 0 10px; font-size: 13px; line-height: 1.5; }
	.label { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
	ul { margin: 0 0 10px; padding-left: 18px; font-size: 13px; line-height: 1.5; }
	li { margin: 0 0 2px; }
	.problem { margin: 8px 0 0; font-size: 12px; color: var(--bad); }
</style>

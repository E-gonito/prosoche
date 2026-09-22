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
	 *
	 * A strip above the timeline rather than a card beside it, and one that
	 * folds away: the briefing is read once in the morning and is in the way
	 * for the rest of the day. Folded or not is remembered per device. It
	 * draws nothing at all on a day that has neither a briefing nor any
	 * prospect of one, because a permanent "nothing was written for this day"
	 * is noise on every day but one.
	 */
	import { regenerateBriefing } from '$lib/client/ai';
	import Icon from '$lib/components/Icon.svelte';
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

	// Something went wrong is not something to hide behind a fold.
	const open = $derived(!collapsed || Boolean(problem || failure));
	/** What the strip says about itself while it is folded: its first line. */
	const gist = $derived(blocks[0]?.[0] ? item(blocks[0][0].replace(/\*\*/g, '')) : '');

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
			{#if isToday}
				<button class="btn small regen" onclick={regenerate} disabled={busy} data-testid="briefing-regenerate">
					{busy ? 'Thinking…' : current ? 'Regenerate' : 'Generate'}
				</button>
			{/if}
		</div>

		{#if open}
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
				<p class="hint">Adding the markers changes your note, so it waits on the <a href="/review">review page</a>.</p>
			{/if}
		{/if}
		{#if problem || failure}<p class="problem">{problem || failure}</p>{/if}
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
	.label { margin: 0 0 var(--s1); font-size: var(--t11); text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
	ul { margin: 0 0 10px; padding-left: 18px; font-size: var(--t13); line-height: 1.5; }
	li { margin: 0 0 2px; }
	.problem { margin: var(--s2) 0 0; font-size: var(--t12); color: var(--bad); }
</style>

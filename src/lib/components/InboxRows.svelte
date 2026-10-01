<script lang="ts">
	/**
	 * Unfiled lines of `Inbox/Capture.md`, each with its five exits: plan it
	 * onto today, file it as a card on a board, note it at the end of a
	 * workspace's Overview.md, add it to a study subject's reading list, drop
	 * it. Every exit ticks the line in place
	 * through `/api/inbox`, so nothing is deleted and the row leaves the list
	 * on the reload that follows.
	 *
	 * A focused row answers `t`, `b`, `n`, `s` and `x` for the five, and the
	 * arrow keys walk the list. `b` and `n` go straight to `fileTo` when it is
	 * given (a workspace's own tab) and otherwise show the workspaces to pick
	 * from, the line's own workspace first. `s` shows the subjects, or files
	 * straight to the only one; with no subjects there is no Study exit.
	 */
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { api } from '$lib/client/api';
	import { displayText } from '$lib/shared/task';
	import type { InboxLine } from '$lib/shared/inbox';

	let {
		lines,
		workspaces,
		subjects = [],
		owners = {},
		fileTo,
		byDay = false,
		onproblem
	}: {
		lines: InboxLine[];
		workspaces: Array<{ slug: string; name: string; color: string }>;
		/** The study subjects a line can go to the reading list of. */
		subjects?: Array<{ slug: string; name: string; color: string }>;
		/** The workspace each line names by tag or alias, keyed by line number. */
		owners?: Record<number, string>;
		/** Given, `b` files to this workspace without asking. */
		fileTo?: string;
		/** Head each day's lines with the day they were captured. */
		byDay?: boolean;
		onproblem?: (message: string) => void;
	} = $props();

	type Exit = 'plan' | 'file' | 'note' | 'study' | 'drop';
	type Picked = 'file' | 'note' | 'study';
	let busy = $state<number | null>(null);
	/** The line whose workspace picker is open, and which exit it is choosing for. */
	let picking = $state<{ line: number; action: Picked } | null>(null);
	let list: HTMLDivElement | undefined = $state();

	async function act(line: InboxLine, action: Exit, target?: string) {
		if (busy !== null) return;
		const index = lines.indexOf(line);
		busy = line.line;
		picking = null;
		const result = await api('/api/inbox', {
			action,
			line: line.line,
			expectedRaw: line.raw,
			...(action === 'study' ? { subject: target } : { workspace: target })
		});
		busy = null;
		if (!result.ok) onproblem?.(result.message);
		await invalidateAll();
		// The row is gone; the one that took its place keeps the keyboard.
		await tick();
		focusRow(Math.min(index, lines.length - 1));
	}

	/**
	 * File, note or study the line: straight to `fileTo` (or the only subject),
	 * else open the picker for that exit.
	 */
	async function pick(line: InboxLine, action: Picked) {
		if (action === 'study') {
			if (subjects.length === 0) return;
			if (subjects.length === 1) return act(line, action, subjects[0].slug);
		} else if (fileTo) return act(line, action, fileTo);
		picking = picking?.line === line.line && picking.action === action ? null : { line: line.line, action };
		await tick();
		list?.querySelector<HTMLElement>('[data-testid="inbox-picker"] button')?.focus();
	}

	/** The picker's choices: subjects for Study, else workspaces with the one the line names first. */
	function choices(line: InboxLine, action: Picked) {
		if (action === 'study') return subjects;
		const own = owners[line.line];
		return own ? [...workspaces.filter((w) => w.slug === own), ...workspaces.filter((w) => w.slug !== own)] : workspaces;
	}

	function focusRow(index: number) {
		list?.querySelectorAll<HTMLElement>('[data-testid="inbox-row"]')[index]?.focus();
	}

	function keydown(event: KeyboardEvent, line: InboxLine, index: number) {
		if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
		const key = event.key.toLowerCase();
		const run: Record<string, () => void> = {
			t: () => void act(line, 'plan'),
			b: () => void pick(line, 'file'),
			n: () => void pick(line, 'note'),
			s: () => void pick(line, 'study'),
			x: () => void act(line, 'drop'),
			arrowdown: () => focusRow(index + 1),
			arrowup: () => focusRow(index - 1),
			escape: () => (picking = null)
		};
		if (!run[key]) return;
		event.preventDefault();
		run[key]();
	}
</script>

<div class="sheet rows inbox-rows" bind:this={list}>
	{#each lines as line, index (line.line)}
		{#if byDay && (index === 0 || lines[index - 1].day !== line.day)}
			<p class="caps day" data-testid="inbox-day">{line.day ?? 'Undated'}</p>
		{/if}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="inbox-row"
			class:busy={busy === line.line}
			data-testid="inbox-row"
			data-line={line.line}
			tabindex="0"
			role="group"
			aria-label={displayText(line.text)}
			onkeydown={(e) => keydown(e, line, index)}
		>
			{#if line.stamp}<span class="stamp num">{line.stamp}</span>{/if}
			<span class="text">{displayText(line.text)}</span>
			{#if line.task?.quadrant}<span class="q q{line.task.quadrant}">Q{line.task.quadrant}</span>{/if}
			<span class="actions">
				<button class="btn ghost small" data-testid="inbox-plan" title="Plan onto today (t)" onclick={() => act(line, 'plan')}>Today</button>
				<button class="btn ghost small" data-testid="inbox-file" title="File as a board card (b)" aria-expanded={fileTo ? undefined : picking?.line === line.line && picking.action === 'file'} onclick={() => pick(line, 'file')}>Board</button>
				<button class="btn ghost small" data-testid="inbox-note" title="Append to a workspace's Overview.md (n)" aria-expanded={fileTo ? undefined : picking?.line === line.line && picking.action === 'note'} onclick={() => pick(line, 'note')}>Note</button>
				{#if subjects.length}
					<button class="btn ghost small" data-testid="inbox-study" title="Add to a subject's reading list (s)" aria-expanded={subjects.length === 1 ? undefined : picking?.line === line.line && picking.action === 'study'} onclick={() => pick(line, 'study')}>Study</button>
				{/if}
				<button class="btn ghost small" data-testid="inbox-drop" title="Drop: tick it, keep the line (x)" onclick={() => act(line, 'drop')}>Drop</button>
			</span>
			{#if picking?.line === line.line}
				{@const exit = picking.action}
				<div class="chips picker" data-testid="inbox-picker" aria-label={exit === 'file' ? 'Which board' : exit === 'note' ? 'Which Overview' : 'Which subject'}>
					{#each choices(line, exit) as w (w.slug)}
						<button class="chip" onclick={() => act(line, exit, w.slug)}><i class="dot" style="--dot: {w.color}"></i>{w.name}</button>
					{:else}
						<span class="muted small">No workspaces yet.</span>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<p class="empty" data-testid="inbox-empty">Nothing waiting. Inbox zero.</p>
	{/each}
</div>

<style>
	.inbox-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s1) var(--s2); }
	.inbox-row:focus-visible { outline: var(--focus); outline-offset: 4px; }
	.stamp { flex: none; font-size: var(--t12); color: var(--muted); }
	.inbox-row.busy { opacity: 0.5; }
	.text { flex: 1 1 16em; min-width: 0; overflow-wrap: anywhere; font-size: var(--t14); }
	.actions { display: flex; gap: var(--s1); flex: none; margin-left: auto; align-self: center; }
	/* A thumb needs more than a small button's height. */
	@media (hover: none) {
		.actions .btn { min-height: 36px; padding: 0 var(--s3); }
	}
	.day { color: var(--muted); }
	.rows > .day + .inbox-row { border-top: 0; padding-top: var(--s1); }
	.picker { flex-basis: 100%; margin: 0; }
	.picker .chip { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
</style>

<script lang="ts">
	/**
	 * Unfiled lines of `Inbox/Capture.md`, each with its three exits: plan it
	 * onto today, file it as a card on a board, drop it. Every exit ticks the
	 * line in place through `/api/inbox`, so nothing is deleted and the row
	 * leaves the list on the reload that follows.
	 *
	 * A focused row answers `t`, `b` and `x` for the three, and the arrow keys
	 * walk the list. `b` files straight to `fileTo` when it is given (a
	 * workspace's own tab) and otherwise shows the workspaces to pick from,
	 * the line's own workspace first.
	 */
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { api } from '$lib/client/api';
	import { displayText } from '$lib/shared/task';
	import type { InboxLine } from '$lib/shared/inbox';

	let {
		lines,
		workspaces,
		owners = {},
		fileTo,
		byDay = false,
		onproblem
	}: {
		lines: InboxLine[];
		workspaces: Array<{ slug: string; name: string; color: string }>;
		/** The workspace each line names by tag or alias, keyed by line number. */
		owners?: Record<number, string>;
		/** Given, `b` files to this workspace without asking. */
		fileTo?: string;
		/** Head each day's lines with the day they were captured. */
		byDay?: boolean;
		onproblem?: (message: string) => void;
	} = $props();

	let busy = $state<number | null>(null);
	/** The line whose board picker is open. */
	let picking = $state<number | null>(null);
	let list: HTMLDivElement | undefined = $state();

	async function act(line: InboxLine, action: 'plan' | 'file' | 'drop', workspace?: string) {
		if (busy !== null) return;
		const index = lines.indexOf(line);
		busy = line.line;
		picking = null;
		const result = await api('/api/inbox', { action, line: line.line, expectedRaw: line.raw, workspace });
		busy = null;
		if (!result.ok) onproblem?.(result.message);
		await invalidateAll();
		// The row is gone; the one that took its place keeps the keyboard.
		await tick();
		focusRow(Math.min(index, lines.length - 1));
	}

	async function file(line: InboxLine) {
		if (fileTo) return act(line, 'file', fileTo);
		picking = picking === line.line ? null : line.line;
		await tick();
		list?.querySelector<HTMLElement>('[data-testid="inbox-picker"] button')?.focus();
	}

	/** The workspaces in picker order: the one the line names first. */
	function choices(line: InboxLine) {
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
			b: () => void file(line),
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
			<span class="text">{displayText(line.text)}</span>
			<span class="actions">
				<button class="btn ghost small" data-testid="inbox-plan" title="Plan onto today (t)" onclick={() => act(line, 'plan')}>Today</button>
				<button class="btn ghost small" data-testid="inbox-file" title="File as a board card (b)" aria-expanded={fileTo ? undefined : picking === line.line} onclick={() => file(line)}>Board</button>
				<button class="btn ghost small" data-testid="inbox-drop" title="Drop: tick it, keep the line (x)" onclick={() => act(line, 'drop')}>Drop</button>
			</span>
			{#if picking === line.line}
				<div class="chips picker" data-testid="inbox-picker">
					{#each choices(line) as w (w.slug)}
						<button class="chip" onclick={() => act(line, 'file', w.slug)}><i class="dot" style="--dot: {w.color}"></i>{w.name}</button>
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
	.inbox-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1) var(--s2); border-radius: var(--r-sm); }
	.inbox-row:focus-visible { outline: var(--focus); outline-offset: 2px; }
	.inbox-row.busy { opacity: 0.5; }
	.text { flex: 1 1 16em; min-width: 0; overflow-wrap: anywhere; font-size: var(--t14); }
	.actions { display: flex; gap: var(--s1); flex: none; margin-left: auto; }
	.day { color: var(--muted); }
	.rows > .day + .inbox-row { border-top: 0; padding-top: var(--s1); }
	.picker { flex-basis: 100%; margin: 0; }
	.picker .chip { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
</style>

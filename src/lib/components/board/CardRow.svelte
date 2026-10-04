<script lang="ts">
	/**
	 * One open board card, shown away from its board: on Today, in Overdue,
	 * or a workspace's list.
	 *
	 * The checkbox ticks the card in its `Board.md`, sent with the hash the
	 * page read that board at. Other cards on the page may come from the same
	 * board and now carry a stale hash, so a tick reloads the page rather
	 * than patching one row. The title links to the workspace, where the board
	 * is; nothing else here writes.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { cardAsTask, dueLabel, type OpenCard } from '$lib/shared/kanban';
	import { drag, startDrag } from '$lib/client/drag.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { Task } from '$lib/shared/task';

	let {
		card,
		today,
		showWorkspace = false,
		draggable = false,
		onschedule,
		onproblem
	}: {
		card: OpenCard;
		/** The real today, `YYYY-MM-DD`, which is what "overdue" is judged against. */
		today: string;
		/** Show the workspace's dot, for a list that mixes workspaces. */
		showWorkspace?: boolean;
		/** Offer the grip that drags the card onto the day. */
		draggable?: boolean;
		/** Given, a clock button asks for the card to be planned onto the day at a time. */
		onschedule?: (task: Task) => void;
		onproblem?: (message: string) => void;
	} = $props();

	let saving = $state(false);
	let done = $state(false);
	const dragging = $derived(drag.task?.path === card.path && drag.task?.line === card.line);

	async function tick() {
		saving = true;
		done = true;
		const result = await api('/api/board', { workspace: card.workspace.slug, hash: card.hash, op: { kind: 'toggle-card', line: card.line, done: true } });
		saving = false;
		if (!result.ok) {
			done = false;
			onproblem?.(result.message);
		}
		await invalidateAll();
	}
</script>

<div class="card-row" class:done class:dragging data-testid="board-card-row" data-line={card.line}>
	{#if draggable}
		<span
			class="grip"
			data-testid="card-grip"
			role="button"
			tabindex="-1"
			aria-label="Drag {card.title} onto the timeline"
			title="Drag onto the timeline to plan it for the day"
			onpointerdown={(e) => startDrag(cardAsTask(card), e)}
		>⠿</span>
	{/if}
	<button
		class="box"
		data-testid="board-card-done"
		onclick={tick}
		disabled={saving || done}
		aria-pressed={done}
		aria-label="Mark &quot;{card.title}&quot; done"
	>{done ? '✓' : ''}</button>
	{#if showWorkspace}<span class="dot" style="--dot: {card.workspace.color}" title={card.workspace.name}></span>{/if}
	<a class="text" href="/w/{card.workspace.slug}" title="On {card.workspace.name}'s board, in {card.column}">{card.title}</a>
	{#if card.due}<span class="due num" class:overdue={card.due < today} data-testid="board-card-due">{dueLabel(card.due, today)}</span>{/if}
	{#if card.priority}<span class="q q{card.priority}">Q{card.priority}</span>{/if}
	{#if onschedule}
		<button
			class="when"
			data-testid="schedule-card"
			onclick={() => onschedule(cardAsTask(card))}
			aria-label="Plan &quot;{card.title}&quot; at a time today"
			title="Plan it at a time"
		><Icon name="clock" size={16} /></button>
	{/if}
</div>

<style>
	.card-row { position: relative; z-index: 1; display: flex; align-items: baseline; gap: var(--s2); font-size: var(--t13); }
	.box { align-self: center; }
	.dragging { opacity: 0.4; }
	/* The same grip as TaskRow's, so both lists pick up the same way. */
	.grip {
		flex: none;
		color: var(--muted);
		cursor: grab;
		align-self: center;
		font-size: var(--t13);
		line-height: 1;
		touch-action: none;
		user-select: none;
	}
	.grip:hover { color: var(--text); }
	.done .text { text-decoration: line-through; color: var(--muted); }
	.dot { align-self: center; }
	.text { flex: 1; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
	.text:hover { color: var(--accent); }
	.due { flex: none; font-size: var(--t11); color: var(--muted); }
	.due.overdue { color: var(--bad); font-weight: 600; }
	/*
	 * Give it a time without dragging. Like the grip, out of the way until
	 * the row is pointed at; on a phone, where nothing is pointed at and the
	 * grip is no use, always there and the size of a thumb, while the grip
	 * goes.
	 */
	.when {
		flex: none;
		align-self: center;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		padding: 0 2px;
		color: var(--muted);
		cursor: pointer;
		opacity: 0;
	}
	.when:hover { color: var(--accent); }
	:hover > .when, .when:focus-visible { opacity: 1; }
	@media (pointer: coarse) {
		.grip { display: none; }
		.when { opacity: 1; min-width: 40px; min-height: 40px; margin: -8px -6px -8px 0; }
	}
</style>

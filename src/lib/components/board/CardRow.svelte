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
	import { dueLabel, type OpenCard } from '$lib/shared/kanban';

	let {
		card,
		today,
		showWorkspace = false,
		onproblem
	}: {
		card: OpenCard;
		/** The real today, `YYYY-MM-DD`, which is what "overdue" is judged against. */
		today: string;
		/** Show the workspace's dot, for a list that mixes workspaces. */
		showWorkspace?: boolean;
		onproblem?: (message: string) => void;
	} = $props();

	let saving = $state(false);
	let done = $state(false);

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

<div class="card-row" class:done data-testid="board-card-row" data-line={card.line}>
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
</div>

<style>
	.card-row { position: relative; z-index: 1; display: flex; align-items: baseline; gap: var(--s2); font-size: var(--t13); }
	.box { align-self: center; }
	.done .text { text-decoration: line-through; color: var(--muted); }
	.dot { align-self: center; }
	.text { flex: 1; min-width: 0; color: var(--text); overflow-wrap: anywhere; }
	.text:hover { color: var(--accent); }
	.due { flex: none; font-size: var(--t11); color: var(--muted); }
	.due.overdue { color: var(--bad); font-weight: 600; }
</style>

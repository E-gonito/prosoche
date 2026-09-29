<script lang="ts">
	/**
	 * A workspace's tasks: the kanban board, or the same cards as a flat,
	 * filterable list for a phone or a quick scan.
	 *
	 * Board and list read the same server data, so a card ticked in one shows
	 * ticked in the other the moment the page reloads it.
	 */
	import { invalidateAll } from '$app/navigation';
	import Board from '$lib/components/board/Board.svelte';
	import TaskRow from '$lib/components/board/TaskRow.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';
	import { cardKey, compareCards } from '$lib/shared/board';
	import type { Task, TaskStatus } from '$lib/shared/task';

	let { data } = $props();

	let view = $state<'board' | 'list'>('board');
	let statusFilter = $state<TaskStatus | 'all'>('all');
	let opened = $state<Task | null>(null);
	let patched = $state<Record<string, Task>>({});

	const STATUSES: Array<{ value: TaskStatus | 'all'; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'todo', label: 'To do' },
		{ value: 'in-progress', label: 'In progress' },
		{ value: 'blocked', label: 'Blocked' },
		{ value: 'done', label: 'Done' },
		{ value: 'cancelled', label: 'Cancelled' }
	];

	const allCards = $derived(data.board.columns.flatMap((c) => c.cards).sort(compareCards));
	const listed = $derived(
		allCards
			.map((c) => (patched[cardKey(c.task)] ? { ...c, task: patched[cardKey(c.task)] } : c))
			.filter((c) => statusFilter === 'all' || c.task.status === statusFilter)
	);
</script>

<div class="toolbar">
	<div class="chips" role="group" aria-label="View">
		<button class="chip" class:on={view === 'board'} data-testid="view-board" onclick={() => (view = 'board')}>Board</button>
		<button class="chip" class:on={view === 'list'} data-testid="view-list" onclick={() => (view = 'list')}>List</button>
	</div>
	{#if view === 'list'}
		<div class="chips" role="group" aria-label="Filter by status">
			{#each STATUSES as s (s.value)}
				<button class="chip" class:on={statusFilter === s.value} onclick={() => (statusFilter = s.value)}>{s.label}</button>
			{/each}
		</div>
	{/if}
</div>

{#if view === 'board'}
	<Board board={data.board} refresh={() => invalidateAll()} />
{:else}
	<div class="sheet rows" data-testid="task-list">
		{#each listed as card (cardKey(card.task))}
			<TaskRow
				task={card.task}
				showPath
				onopen={(t) => (opened = t)}
				onchange={(t) => (patched = { ...patched, [cardKey(t)]: t })}
			/>
		{:else}
			<p class="none">Nothing in this status.</p>
		{/each}
	</div>
{/if}

{#if opened}
	<CardDrawer task={opened} onclose={() => (opened = null)} onchange={(t) => (patched = { ...patched, [cardKey(t)]: t })} />
{/if}

<style>
	.toolbar { display: flex; flex-wrap: wrap; gap: var(--s3); align-items: center; margin-bottom: var(--s3); }
</style>

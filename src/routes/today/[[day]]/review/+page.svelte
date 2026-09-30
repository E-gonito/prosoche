<script lang="ts">
	/**
	 * The evening review: every task of the day's note, timed blocks first as
	 * the timeline has them and the rest in note order, each with a large tick
	 * and a skip. Tick writes `[x]`, skip writes `[-]`, and pressing either
	 * again takes the line back to `[ ]`; each is one character on one line,
	 * through `/api/task` with the line as this page last saw it, so a line
	 * changed elsewhere is refused and the page reloads. Nothing is ticked
	 * without a press.
	 *
	 * A focused row answers space or Enter (tick) and `s` (skip); the arrows
	 * walk the list. It ends with the inbox count, so closing the day includes
	 * emptying it.
	 */
	import { invalidateAll } from '$app/navigation';
	import { editTask } from '$lib/client/api';
	import { formatMinutes } from '$lib/shared/time';
	import { displayText, isDone, isSkipped, type Task, type TaskStatus } from '$lib/shared/task';

	let { data } = $props();

	const tasks = $derived([...data.scheduled, ...data.unscheduled]);
	const todayHref = $derived(data.isToday ? '/today' : `/today/${data.day}`);
	let busy = $state<number | null>(null);
	let problem = $state('');
	let list: HTMLDivElement | undefined = $state();

	/** Tick and skip each toggle: pressed again, the line is open once more. */
	async function set(task: Task, to: 'done' | 'cancelled') {
		if (busy !== null) return;
		const status: TaskStatus = task.status === to ? 'todo' : to;
		busy = task.line;
		const result = await editTask(task, { status });
		problem = result.ok ? '' : result.message;
		await invalidateAll();
		busy = null;
	}

	function focusRow(index: number) {
		list?.querySelectorAll<HTMLElement>('[data-testid="review-row"]')[index]?.focus();
	}

	function keydown(event: KeyboardEvent, task: Task, index: number) {
		if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
		const run: Record<string, () => void> = {
			' ': () => void set(task, 'done'),
			enter: () => void set(task, 'done'),
			s: () => void set(task, 'cancelled'),
			arrowdown: () => focusRow(index + 1),
			arrowup: () => focusRow(index - 1)
		};
		const action = run[event.key.toLowerCase()];
		if (!action) return;
		event.preventDefault();
		action();
	}
</script>

<svelte:head><title>Review · {data.label} · prosoche</title></svelte:head>

<div class="page review">
	<div class="title">
		<a class="crumb" href={todayHref}>← {data.isToday ? 'Today' : data.label}</a>
		<h1>Review the day</h1>
		<p class="sub"><span class="relative">{data.relative}</span>, {data.label}</p>
		<p class="summary" data-testid="review-summary">{data.summary}</p>
	</div>

	{#if problem}<p class="problem" role="status">{problem}</p>{/if}

	{#if !data.exists}
		<p class="empty big" data-testid="review-no-note">No note for this day, so nothing to review. <a href={todayHref}>Open the day</a> to create it.</p>
	{:else}
		<div class="sheet rows" bind:this={list}>
			{#each tasks as task, index (task.path + ':' + task.line)}
				{@const done = isDone(task)}
				{@const skipped = isSkipped(task)}
				{@const owner = data.owners[`${task.path}:${task.line}`]}
				{@const words = displayText(task.text)}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<div
					class="review-row"
					class:closed={done || skipped}
					class:busy={busy === task.line}
					aria-busy={busy === task.line}
					data-testid="review-row"
					data-line={task.line}
					tabindex="0"
					role="group"
					aria-label={words}
					onkeydown={(e) => keydown(e, task, index)}
				>
					<button
						class="box"
						data-testid="review-tick"
						aria-pressed={done ? true : skipped ? 'mixed' : false}
						aria-label={done ? `Mark "${words}" not done` : `Mark "${words}" done`}
						onclick={() => set(task, 'done')}
					>{done ? '✓' : skipped ? '–' : ''}</button>
					{#if task.startMin !== null && task.endMin !== null}
						<span class="time num">{formatMinutes(task.startMin)}–{formatMinutes(task.endMin)}</span>
					{/if}
					{#if owner}<i class="dot" style="--dot: {owner.color}" title={owner.name}></i>{/if}
					<span class="text">{words}</span>
					<button
						class="btn ghost small skip"
						data-testid="review-skip"
						aria-pressed={skipped}
						title={skipped ? 'Not skipped after all (s)' : 'Skipped today (s)'}
						onclick={() => set(task, 'cancelled')}
					>{skipped ? 'Skipped' : 'Skip'}</button>
				</div>
			{:else}
				<p class="empty">Nothing planned on this day.</p>
			{/each}
		</div>
		{#if tasks.length}
			<p class="hint keys">Focus a row, then <kbd>space</kbd> ticks it and <kbd>s</kbd> skips it. Press either again to reopen it.</p>
		{/if}
	{/if}

	<p class="inbox" data-testid="review-inbox">
		{#if data.inbox.count}
			<a href="/inbox"><span class="num">{data.inbox.count}</span> in the inbox</a>, to triage before you close the day.
		{:else}
			Inbox zero.
		{/if}
	</p>
</div>

<style>
	.sub, .summary { margin: var(--s1) 0 0; color: var(--muted); font-size: var(--t14); }
	.sub .relative { text-transform: capitalize; }

	.review-row { display: flex; align-items: center; gap: var(--s3); min-height: 44px; }
	.review-row:focus-visible { outline: var(--focus); outline-offset: 2px; }
	.review-row.busy { opacity: 0.5; }
	/* The tick is the point of the screen, so it is thumb-sized. */
	.box { width: 28px; height: 28px; border-radius: var(--r-sm); font-size: var(--t16); }
	.time { flex: none; font-size: var(--t12); color: var(--muted); }
	.text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.closed .text { text-decoration: line-through; color: var(--muted); }
	.skip { flex: none; }
	.skip[aria-pressed='true'] { color: var(--text); background: var(--soft); }
	@media (hover: none) {
		.skip { min-height: 36px; padding: 0 var(--s3); }
		.keys { display: none; }
	}

	.keys { margin-top: var(--s3); }
	kbd { font-family: var(--mono); font-size: var(--t12); padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
	.inbox { margin-top: var(--s5); font-size: var(--t15); }
</style>

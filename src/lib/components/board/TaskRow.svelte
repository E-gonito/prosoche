<script lang="ts">
	/**
	 * One task, as a row in a flat list rather than a board column.
	 *
	 * Adapted from `$lib/components/TaskRow.svelte` for the workspace Tasks
	 * page's list view: everything about a row is the same except the timer
	 * button, which reached into `$lib/client/timer.svelte`, a parked feature
	 * this module must not depend on. Ticking, the due chip, the quadrant and
	 * the workspace dot all still work the one way this app ticks a task,
	 * through `editTask`.
	 */
	import { displayText, isDone, type Task } from '$lib/shared/task';
	import { editTask } from '$lib/client/api';

	let {
		task,
		onchange,
		onproblem,
		onopen,
		showPath = false
	}: {
		task: Task;
		onchange?: (task: Task) => void;
		onproblem?: (message: string) => void;
		/** Given, the row's text opens the card. Absent, the text is text. */
		onopen?: (task: Task) => void;
		showPath?: boolean;
	} = $props();

	let saving = $state(false);
	const done = $derived(isDone(task));

	async function toggle() {
		if (saving) return;
		saving = true;
		const result = await editTask(task, { status: done ? 'todo' : 'done' });
		saving = false;
		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}
</script>

<div class="task" data-testid="task-row" data-line={task.line} data-path={task.path} class:done class:saving>
	<button
		class="box"
		data-testid="checkbox"
		onclick={toggle}
		disabled={saving}
		aria-pressed={done}
		aria-label={done ? `Mark "${displayText(task.text)}" not done` : `Mark "${displayText(task.text)}" done`}
	>
		{done ? '✓' : ''}
	</button>
	{#if onopen}
		<button class="text open" data-testid="open-task" title="Open the card" onclick={() => onopen(task)}>
			{displayText(task.text)}
		</button>
	{:else}
		<span class="text">{displayText(task.text)}</span>
	{/if}
	{#if task.due}<span class="due num" data-testid="task-due">{task.due}</span>{/if}
	{#if task.quadrant}<span class="q q{task.quadrant}">Q{task.quadrant}</span>{/if}
	{#if showPath}<span class="path">{task.path.split('/').pop()?.replace(/\.md$/, '')}</span>{/if}
</div>

<style>
	.task {
		display: flex;
		align-items: baseline;
		gap: var(--s2);
		padding: 7px var(--s1);
		border-top: 1px solid var(--line);
	}
	.task:first-child { border-top: 0; }
	.saving { opacity: 0.6; }
	.box {
		flex: none;
		width: var(--s4);
		height: var(--s4);
		padding: 0;
		border: 1.5px solid #9aa0a6;
		border-radius: 3px;
		background: var(--field);
		font-size: var(--t11);
		line-height: 1;
		color: #fff;
		cursor: pointer;
		align-self: center;
	}
	.box:hover { border-color: var(--accent); }
	.done .box { background: var(--accent); border-color: var(--accent); }
	.done .text { text-decoration: line-through; color: var(--muted); }
	.text { flex: 1; min-width: 0; }
	.text.open {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}
	.text.open:hover { text-decoration: underline; }
	.text.open:focus-visible { outline: var(--focus); outline-offset: 2px; border-radius: 3px; }
	.due { font-size: var(--t11); color: var(--muted); flex: none; }
	.path { font-size: var(--t11); color: var(--muted); flex: none; }
</style>

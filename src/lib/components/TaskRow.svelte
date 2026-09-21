<script lang="ts">
	import { formatMinutes } from '$lib/shared/time';
	import { displayText, isDone, type Task } from '$lib/shared/task';
	import { editTask } from '$lib/client/api';
	import { startDrag, drag } from '$lib/client/drag.svelte';
	import { timer } from '$lib/client/timer.svelte';

	let {
		task,
		onchange,
		onproblem,
		showPath = false,
		draggable = false
	}: {
		task: Task;
		onchange?: (task: Task) => void;
		onproblem?: (message: string) => void;
		showPath?: boolean;
		draggable?: boolean;
	} = $props();

	let saving = $state(false);
	const done = $derived(isDone(task));
	const dragging = $derived(drag.task?.path === task.path && drag.task?.line === task.line);
	// Starting a timer stops whatever was running, so the button on the row
	// that is already being timed is a stop button rather than a no-op.
	const timing = $derived(timer.task?.path === task.path && timer.task?.line === task.line);

	async function toggle() {
		if (saving) return;
		saving = true;
		const result = await editTask(task, { status: done ? 'todo' : 'done' });
		saving = false;
		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}
</script>

<div class="task" data-testid="task-row" data-line={task.line} data-path={task.path} class:done class:saving class:dragging>
	{#if draggable}
		<span
			class="grip"
			data-testid="grip"
			role="button"
			tabindex="-1"
			aria-label="Drag {displayText(task.text)} onto the timeline"
			title="Drag onto the timeline to give it a time"
			onpointerdown={(e) => startDrag(task, e)}
		>⠿</span>
	{/if}
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
	{#if task.startMin !== null && task.endMin !== null}
		<span class="time">{formatMinutes(task.startMin)}–{formatMinutes(task.endMin)}</span>
	{/if}
	<span class="text">{displayText(task.text)}</span>
	{#if !done}
		<button
			class="run"
			class:timing
			data-testid="task-timer"
			onclick={() => (timing ? timer.stop() : timer.start(task.path, task.line))}
			disabled={timer.busy}
			aria-pressed={timing}
			aria-label={timing ? `Stop timing "${displayText(task.text)}"` : `Start timing "${displayText(task.text)}"`}
			title={timing ? 'Stop and log the time' : 'Start timing this'}
		>{timing ? '■' : '▶'}</button>
	{/if}
	{#if task.quadrant}<span class="q q{task.quadrant}">Q{task.quadrant}</span>{/if}
	{#if showPath}<span class="path">{task.path.split('/').pop()?.replace(/\.md$/, '')}</span>{/if}
</div>

<style>
	.task {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 7px 4px;
		border-top: 1px solid var(--line);
	}
	.task:first-child { border-top: 0; }
	.saving { opacity: 0.6; }
	.dragging { opacity: 0.4; }
	.grip {
		flex: none;
		color: var(--muted);
		cursor: grab;
		align-self: center;
		font-size: 13px;
		line-height: 1;
		touch-action: none;
		user-select: none;
	}
	.grip:hover { color: var(--text); }
	.box {
		flex: none;
		width: 16px;
		height: 16px;
		padding: 0;
		border: 1.5px solid #9aa0a6;
		border-radius: 3px;
		background: #fff;
		font-size: 11px;
		line-height: 1;
		color: #fff;
		cursor: pointer;
		align-self: center;
	}
	.box:hover { border-color: var(--accent); }
	.done .box { background: var(--accent); border-color: var(--accent); }
	.done .text { text-decoration: line-through; color: var(--muted); }
	.time { font: 11px var(--mono); color: var(--muted); flex: none; }
	/*
	 * Kept out of the way until the row is under the pointer, because most
	 * rows are read rather than timed, and always visible once a timer is
	 * running on this one so it can be stopped from where it was started.
	 */
	.run {
		flex: none;
		align-self: center;
		border: 0;
		background: none;
		padding: 0 2px;
		font-size: 10px;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
		opacity: 0;
	}
	.task:hover .run, .run:focus-visible, .run.timing { opacity: 1; }
	.run:hover { color: var(--accent); }
	.run.timing { color: var(--q1); }
	.text { flex: 1; min-width: 0; }
	.path { font-size: 11px; color: var(--muted); flex: none; }
</style>

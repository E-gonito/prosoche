<script lang="ts">
	import { formatMinutes } from '$lib/shared/time';
	import { displayText, isDone, isSkipped, type Task } from '$lib/shared/task';
	import { editTask } from '$lib/client/api';
	import { startDrag, drag } from '$lib/client/drag.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let {
		task,
		onchange,
		onproblem,
		onopen,
		onadd,
		onschedule,
		workspace = null,
		overdue = false,
		showPath = false,
		draggable = false
	}: {
		task: Task;
		onchange?: (task: Task) => void;
		onproblem?: (message: string) => void;
		/** Given, the row's text opens the card. Absent, the text is text. */
		onopen?: (task: Task) => void;
		/**
		 * Given, the row offers to put this task on the day. Absent, no button:
		 * a row that is already on the day has nothing to add it to.
		 */
		onadd?: (task: Task) => void | Promise<void>;
		/** Given, a clock button asks for this task to be given a time. */
		onschedule?: (task: Task) => void;
		/** The workspace this task belongs to, worked out by the server. */
		workspace?: { slug: string; name: string; color: string } | null;
		/** Whether the due date has passed, decided by the server's today. */
		overdue?: boolean;
		showPath?: boolean;
		draggable?: boolean;
	} = $props();

	let saving = $state(false);
	let adding = $state(false);
	const done = $derived(isDone(task));
	// Skipped is struck through like done, and the box takes it back to open.
	const skipped = $derived(isSkipped(task));
	const dragging = $derived(drag.task?.path === task.path && drag.task?.line === task.line);

	async function add() {
		if (adding) return;
		adding = true;
		// The caller reloads, which unmounts this row; the flag is reset anyway
		// so a caller that only reports a problem leaves a usable button.
		try {
			await onadd?.(task);
		} finally {
			adding = false;
		}
	}

	async function toggle() {
		if (saving) return;
		saving = true;
		const result = await editTask(task, { status: done || skipped ? 'todo' : 'done' });
		saving = false;
		if (result.ok) onchange?.(result.value);
		else onproblem?.(result.message);
	}
</script>

<div class="task" data-testid="task-row" data-line={task.line} data-path={task.path} class:done={done || skipped} class:saving class:dragging>
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
		aria-pressed={done ? true : skipped ? 'mixed' : false}
		aria-label={done ? `Mark "${displayText(task.text)}" not done` : skipped ? `Mark "${displayText(task.text)}" not skipped` : `Mark "${displayText(task.text)}" done`}
	>
		{done ? '✓' : skipped ? '–' : ''}
	</button>
	{#if task.startMin !== null && task.endMin !== null}
		<span class="time">{formatMinutes(task.startMin)}–{formatMinutes(task.endMin)}</span>
	{/if}
	{#if workspace}
		<span class="dot" data-testid="task-workspace" style="--dot: {workspace.color}" title={workspace.name}></span>
	{/if}
	{#if onopen}
		<button class="text open" data-testid="open-task" title="Open the card" onclick={() => onopen(task)}>
			{displayText(task.text)}
		</button>
	{:else}
		<span class="text">{displayText(task.text)}</span>
	{/if}
	{#if onadd}
		<button
			class="add"
			data-testid="add-to-today"
			onclick={add}
			disabled={adding}
			aria-label="Add &quot;{displayText(task.text)}&quot; to today"
			title="Add to today, with no time yet"
		><Icon name="plus" size={12} /></button>
	{/if}
	{#if task.due}<span class="due num" class:overdue data-testid="task-due">{task.due}</span>{/if}
	{#if task.quadrant}<span class="q q{task.quadrant}">Q{task.quadrant}</span>{/if}
	{#if showPath}<span class="path">{task.path.split('/').pop()?.replace(/\.md$/, '')}</span>{/if}
	{#if onschedule}
		<button
			class="when"
			data-testid="schedule-task"
			onclick={() => onschedule(task)}
			aria-label="Give &quot;{displayText(task.text)}&quot; a time"
			title="Give it a time"
		><Icon name="clock" size={16} /></button>
	{/if}
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
	.dragging { opacity: 0.4; }
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
	.box { align-self: center; }
	.done .text { text-decoration: line-through; color: var(--muted); }
	/* A time is a number, so body text with the figures lined up. */
	.time { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); flex: none; }
	/* Kept out of the way until the row is under the pointer, because most
	   rows are read rather than acted on. */
	.add {
		flex: none;
		align-self: center;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		padding: 0 2px;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
		opacity: 0;
	}
	.task:hover .add, .add:focus-visible { opacity: 1; }
	/*
	 * There is no hover on a phone, so "appears when you point at it" means
	 * "does not exist". Shown faintly instead: present enough to find, quiet
	 * enough that a list of tasks still reads as a list of tasks.
	 */
	@media (hover: none) {
		.add { opacity: 0.55; }
	}
	.add:hover { color: var(--accent); }
	.text { flex: 1; min-width: 0; }
	/*
	 * The text itself is the control, so the row still reads as a row: no
	 * border, no background, the same type, and the underline only once the
	 * pointer says it is about to be used.
	 */
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
	/* The workspace this line belongs to, by its tag, its folder or its words. */
	.dot { align-self: center; }
	/* A date is a fact about the line, so it reads like the time does, and
	   turns the warning colour only once it has gone by. */
	.due { font-size: var(--t11); color: var(--muted); flex: none; }
	.due.overdue { color: var(--warn); font-weight: 600; }
	.path { font-size: var(--t11); color: var(--muted); flex: none; }
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

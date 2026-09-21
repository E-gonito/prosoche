<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Timeline from '$lib/components/Timeline.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import Capture from '$lib/components/Capture.svelte';
	import Briefing from '$lib/components/Briefing.svelte';
	import { createDay } from '$lib/client/api';
	import { displayText, isDone, type Task } from '$lib/shared/task';
	import { drag, registerDropZone } from '$lib/client/drag.svelte';
	import { editTask } from '$lib/client/api';

	let { data } = $props();

	// Edited tasks are held as a patch layer over the server's data rather than
	// copied into local state. Copying meant the first render was always empty,
	// so nothing appeared until hydration and the server sent a blank timeline.
	// Deriving instead keeps server rendering intact and makes a task moving
	// between scheduled and unscheduled fall out of the filters for free.
	let patches = $state(new Map<string, Task>());
	let problem = $state('');
	let creating = $state(false);
	let filter = $state<string | null>(null);

	const keyOf = (task: Task) => `${data.day}|${task.path}:${task.line}`;
	const merge = (list: Task[]) => list.map((task) => patches.get(keyOf(task)) ?? task);

	const all = $derived([...merge(data.scheduled), ...merge(data.unscheduled)]);
	const scheduled = $derived(
		all.filter((t) => t.startMin !== null).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))
	);
	const unscheduled = $derived(all.filter((t) => t.startMin === null));

	function applied(updated: Task) {
		problem = '';
		const next = new Map(patches);
		next.set(keyOf(updated), updated);
		patches = next;
	}

	function failed(message: string) {
		problem = message;
		if (message.includes('changed')) invalidateAll();
	}

	// The Unscheduled card is a drop zone, so a block dragged off the timeline
	// lands somewhere meaningful rather than just vanishing from the grid.
	let unscheduledCard: HTMLDivElement | undefined = $state();
	$effect(() => {
		if (!unscheduledCard) return;
		return registerDropZone({
			id: 'unscheduled',
			element: unscheduledCard,
			drop: (task) => void clearTime(task)
		});
	});

	async function clearTime(task: Task) {
		if (task.startMin === null) return;
		const result = await editTask(task, { time: null });
		if (result.ok) applied(result.value);
		else failed(result.message);
	}

	async function makeDay() {
		creating = true;
		const result = await createDay(data.day);
		creating = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	const hours = $derived(Math.floor(data.plannedMinutes / 60));
	const mins = $derived(data.plannedMinutes % 60);
	const doneCount = $derived([...scheduled, ...unscheduled].filter(isDone).length);
	const openCount = $derived(scheduled.length + unscheduled.length - doneCount);
	const visibleGroups = $derived(filter ? data.groups.filter((g) => g.slug === filter) : data.groups);
</script>

<svelte:head><title>{data.label} · prosoche</title></svelte:head>

<div class="head">
	<h1>{data.label}</h1>
	<div class="actions">
		<a class="btn" href="/day/{data.prev}" aria-label="Previous day">‹</a>
		{#if !data.isToday}<a class="btn" href="/">Today</a>{/if}
		<a class="btn" href="/day/{data.next}" aria-label="Next day">›</a>
		{#if data.exists}
			<a class="btn" href="/notes/{data.path.split('/').map(encodeURIComponent).join('/')}">Edit note</a>
		{/if}
	</div>
</div>

{#if problem}
	<div class="card problem" role="status">{problem}</div>
{/if}

{#if !data.exists}
	<div class="card empty">
		<p>No note for this day yet.</p>
		<button class="btn primary" onclick={makeDay} disabled={creating}>
			{creating ? 'Creating…' : 'Create it from your template'}
		</button>
		<p class="hint">Copies Journal/Journal Template.md exactly as it is.</p>
	</div>
{:else}
	<div class="grid">
		<div class="main">
			<div class="card">
				<h3>
					Timeline
					<span class="right">
						{hours}h {mins}m of the day blocked · {doneCount} done, {openCount} open
						{#if data.overlaps}· {data.overlaps} overlapping{/if}
					</span>
				</h3>
				<Timeline tasks={scheduled} isToday={data.isToday} onchange={applied} onproblem={failed} />
			</div>

			<details class="card">
				<summary>The whole note</summary>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="prose">{@html data.html}</div>
			</details>
		</div>

		<div class="side">
			<Briefing day={data.day} text={data.briefing} isToday={data.isToday} />

			<div class="card" data-testid="unscheduled" class:receiving={drag.task !== null && drag.task.startMin !== null} bind:this={unscheduledCard}>
				<h3>Unscheduled <span class="right">{unscheduled.length}</span></h3>
				{#each unscheduled as task (task.path + ':' + task.line)}
					<TaskRow {task} draggable onchange={applied} onproblem={failed} />
				{:else}
					<p class="hint">Everything in this note has a time.</p>
				{/each}
				{#if unscheduled.length}
					<p class="hint">Drag the ⠿ grip onto the timeline to give one a time.</p>
				{:else}
					<p class="hint">Drag a block off the timeline onto this card to take its time off.</p>
				{/if}
			</div>

			<div class="card">
				<h3>
					From your workspaces
					<span class="right">{data.groups.reduce((n, g) => n + g.tasks.length, 0)} open</span>
				</h3>
				{#if data.groups.length > 1}
					<div class="chips">
						<button class="chip" class:on={filter === null} onclick={() => (filter = null)}>All</button>
						{#each data.groups as group (group.slug)}
							<button class="chip" class:on={filter === group.slug} onclick={() => (filter = group.slug)}>
								<i style="background: {group.color}"></i>{group.name}
							</button>
						{/each}
					</div>
				{/if}
				{#each visibleGroups as group (group.slug)}
					<h4><i style="background: {group.color}"></i>{group.name}</h4>
					{#each group.tasks.slice(0, 12) as task (task.path + ':' + task.line)}
						<TaskRow {task} showPath draggable onchange={applied} onproblem={failed} />
					{/each}
					{#if group.tasks.length > 12}
						<p class="hint">and {group.tasks.length - 12} more</p>
					{/if}
				{:else}
					<p class="hint">
						Nothing here yet, and that is correct rather than broken.
					</p>
					<p class="hint">
						This list only shows tasks carrying a quadrant, because that is how you mark a line you actually
						intend to do. Right now every task like that lives in a daily note, and those are excluded: each
						one is a copy of your template, so they would repeat the same unfinished checklist every day.
					</p>
					{#if data.checklistCount}
						<p class="hint">
							{data.checklistCount} other checkbox lines were left out. They are checklist notation inside
							reference notes, such as the syllabus and the manual test plan, rather than work to schedule.
							Add a <code>`Q1`</code> to one and it will appear here.
						</p>
					{/if}
				{/each}
			</div>

			<div class="card">
				<h3>Quick capture</h3>
				<Capture onproblem={failed} />
			</div>

			{#if data.backlog.length}
				<div class="card">
					<h3>Backlog <span class="right">inside a code fence</span></h3>
					{#each data.backlog as task (task.line)}
						<div class="fenced">
							<span class="text">{displayText(task.text)}</span>
							{#if task.quadrant}<span class="q q{task.quadrant}">Q{task.quadrant}</span>{/if}
						</div>
					{/each}
					<p class="hint">Obsidian treats these as text, not tasks, so they are shown read-only.</p>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if drag.task}
	<div class="ghost" style="left: {drag.x + 12}px; top: {drag.y - 10}px">{displayText(drag.task.text)}</div>
{/if}

<style>
	.receiving { outline: 2px dashed var(--accent); outline-offset: -2px; }
	.ghost {
		position: fixed;
		z-index: 50;
		pointer-events: none;
		background: var(--text);
		color: #fff;
		border-radius: 6px;
		padding: 4px 9px;
		font-size: 12px;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
	}
	.head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
	.head h1 { margin: 0; font-size: 22px; }
	.actions { margin-left: auto; display: flex; gap: 8px; }
	.grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; align-items: start; }
	.main, .side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
	.problem { border-color: #fca5a5; background: #fff7f7; margin-bottom: 12px; }
	.empty { text-align: center; }
	.empty p { margin: 0 0 10px; }
	details summary { cursor: pointer; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	details[open] summary { margin-bottom: 12px; }

	.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
	.chip {
		border: 1px solid var(--line);
		background: #fff;
		border-radius: 999px;
		padding: 3px 10px;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.chip.on { background: var(--text); color: #fff; border-color: var(--text); }
	i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }

	h4 {
		margin: 12px 0 2px;
		font-size: 12px;
		color: var(--muted);
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.fenced { display: flex; gap: 8px; align-items: baseline; padding: 5px 4px; border-top: 1px solid var(--line); color: var(--muted); }
	.fenced .text { flex: 1; }

	@media (max-width: 960px) {
		.grid { grid-template-columns: 1fr; }
	}
</style>

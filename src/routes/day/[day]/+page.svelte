<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Timeline from '$lib/components/Timeline.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';
	import Capture from '$lib/components/Capture.svelte';
	import Briefing from '$lib/components/Briefing.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { createDay, planOnDay } from '$lib/client/api';
	import { displayText, isDone, type Task } from '$lib/shared/task';
	import { formatDuration } from '$lib/shared/duration';
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
	// The card being edited, if any. Quadrant, due date and workspace all live
	// in the drawer, so the day does not grow a second set of controls for them.
	let opened = $state<Task | null>(null);

	const keyOf = (task: Task) => `${data.day}|${task.path}:${task.line}`;
	/** The workspace the server attributed a task to, for its coloured dot. */
	const ownerOf = (task: Task) => data.owners[`${task.path}:${task.line}`] ?? null;
	/** Whether the server judged this task late, for the colour of its due chip. */
	const isOverdue = (task: Task) => data.overdue[`${task.path}:${task.line}`] ?? false;
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

	// A card planned onto the day is a new line in a note this page loaded, so
	// the patch layer has nothing to patch: reload rather than guess.
	async function planned() {
		problem = '';
		await invalidateAll();
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

	/**
	 * Which of the two columns a phone is showing.
	 *
	 * On a phone the two columns stack into a two-thousand pixel scroll, and
	 * the half you want is always the half you are not looking at. A segmented
	 * control shows one at a time; the choice is remembered per device, and it
	 * means nothing at all on a wide screen, where both are on screen anyway.
	 */
	type Segment = 'timeline' | 'tasks';
	let segment = $state<Segment>('timeline');
	$effect(() => {
		if (localStorage.getItem('hub:day-segment') === 'tasks') segment = 'tasks';
	});
	function show(next: Segment) {
		segment = next;
		localStorage.setItem('hub:day-segment', next);
	}

	async function clearTime(task: Task) {
		if (task.startMin === null) return;
		const result = await editTask(task, { time: null });
		if (result.ok) applied(result.value);
		else failed(result.message);
	}

	/**
	 * Add a workspace card to this day with no time on it, so it lands in
	 * Unscheduled and can be dragged onto the timeline from there. The same
	 * endpoint a drop onto the grid uses, minus the time: a phone has no drag.
	 */
	async function addToDay(task: Task) {
		problem = '';
		const result = await planOnDay(data.day, task);
		if (result.ok) await invalidateAll();
		else failed(result.message);
	}

	/**
	 * What one workspace did with the day, in as few words as it takes. The
	 * planned figure is dropped once it has all been done, because "7h done of
	 * 7h" is the same sentence twice.
	 */
	function split(w: { plannedMinutes: number; doneMinutes: number }): string {
		if (w.doneMinutes === 0) return `${formatDuration(w.plannedMinutes, ' ')} planned`;
		const done = `${formatDuration(w.doneMinutes, ' ')} done`;
		return w.doneMinutes >= w.plannedMinutes ? done : `${done} of ${formatDuration(w.plannedMinutes, ' ')}`;
	}

	async function makeDay() {
		creating = true;
		const result = await createDay(data.day);
		creating = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	const total = $derived(scheduled.length + unscheduled.length);
	const doneCount = $derived([...scheduled, ...unscheduled].filter(isDone).length);
	const visibleGroups = $derived(filter ? data.groups.filter((g) => g.slug === filter) : data.groups);
	// Nothing claims these, so no workspace filter can select them either.
	const showElsewhere = $derived(filter === null && data.unassigned.length > 0);
</script>

<svelte:head><title>{data.label} · prosoche</title></svelte:head>

<PageHeader title={data.label}>
	{#snippet actions()}
		<a class="btn" href="/day/{data.prev}" aria-label="Previous day"><Icon name="chevron-left" /></a>
		{#if !data.isToday}<a class="btn" href="/">Today</a>{/if}
		<a class="btn" href="/day/{data.next}" aria-label="Next day"><Icon name="chevron-right" /></a>
		{#if data.exists}
			<a class="btn" href="/notes/{data.path.split('/').map(encodeURIComponent).join('/')}">Edit note</a>
		{/if}
	{/snippet}
</PageHeader>

{#if problem}
	<div class="card problem" role="status">{problem}</div>
{/if}

{#if data.conflicted}
	<p class="problem" data-testid="conflict">
		This note has git conflict markers. Resolve it in Obsidian or on the <a href="/sync">sync page</a>.
	</p>
{/if}

{#if !data.exists}
	<div class="card">
		<EmptyState
			icon="file-text"
			title="No note for this day yet."
			hint="Copies Journal/Journal Template.md exactly as it is."
		>
			{#snippet action()}
				<button class="btn primary" onclick={makeDay} disabled={creating}>
					{creating ? 'Creating…' : 'Create it from your template'}
				</button>
			{/snippet}
		</EmptyState>
	</div>
{:else}
	<div class="segmented" data-testid="day-segment" role="tablist" aria-label="What to show">
		<button role="tab" aria-selected={segment === 'timeline'} data-testid="segment-timeline" onclick={() => show('timeline')}>
			Timeline
		</button>
		<button role="tab" aria-selected={segment === 'tasks'} data-testid="segment-tasks" onclick={() => show('tasks')}>
			Tasks
		</button>
	</div>

	<div class="grid" class:showing-tasks={segment === 'tasks'}>
		<div class="main">
			<Briefing day={data.day} text={data.briefing} isToday={data.isToday} />

			<div class="card day-timeline">
				<h3>
					Timeline
					<span class="chips right">
						<span class="chip quiet num">{formatDuration(data.plannedMinutes, ' ')}</span>
						<span class="chip quiet num">{doneCount} of {total} done</span>
						{#if data.overlaps}<span class="chip quiet over num">{data.overlaps} overlapping</span>{/if}
					</span>
				</h3>
				<!-- What the hours are for. One chip per project with a block
				     today; blocks no workspace claims are simply not in it. -->
				{#if data.dayByWorkspace.length}
					<div class="chips by-workspace" data-testid="day-workspaces">
						{#each data.dayByWorkspace as w (w.slug)}
							<span class="chip quiet num" data-testid="day-workspace" data-slug={w.slug}>
								<i style="background: {w.color}"></i>{w.name} {split(w)}
							</span>
						{/each}
					</div>
				{/if}
				<!-- Keyed on the date and the segment: another day is another
				     timeline, and a phone returning to this one wants it at the
				     current hour again rather than where it was left. -->
				{#key data.day + segment}
					<Timeline
						tasks={scheduled}
						isToday={data.isToday}
						day={data.day}
						dayPath={data.path}
						owners={data.owners}
						onchange={applied}
						onplanned={planned}
						onproblem={failed}
						onopen={(task) => (opened = task)}
					/>
				{/key}
			</div>

			<details class="card">
				<summary>The whole note</summary>
				{#if data.backlog.length}
					<section class="backlog">
						<h4>Backlog <span class="right">inside a code fence, so read-only</span></h4>
						{#each data.backlog as task (task.line)}
							<div class="fenced">
								<span class="text">{displayText(task.text)}</span>
								{#if task.quadrant}<span class="q q{task.quadrant}">Q{task.quadrant}</span>{/if}
							</div>
						{/each}
					</section>
				{/if}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="prose">{@html data.html}</div>
			</details>
		</div>

		<div class="side">
			<div class="card" data-testid="unscheduled" class:receiving={drag.task !== null && drag.task.startMin !== null} bind:this={unscheduledCard}>
				<h3>Unscheduled <span class="right">{unscheduled.length}</span></h3>
				<Capture onproblem={failed} />
				{#each unscheduled as task (task.path + ':' + task.line)}
					<TaskRow
						{task}
						draggable
						workspace={ownerOf(task)}
						onchange={applied}
						onproblem={failed}
						onopen={(t) => (opened = t)}
					/>
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
						<TaskRow
							{task}
							showPath
							draggable
							overdue={isOverdue(task)}
							onchange={applied}
							onproblem={failed}
							onopen={(t) => (opened = t)}
							onadd={addToDay}
						/>
					{/each}
					{#if group.tasks.length > 12}
						<p class="hint">and {group.tasks.length - 12} more</p>
					{/if}
				{/each}
				<!-- Open work carrying a quadrant that no workspace claims. A
				     group of its own, and only when there is some, so the card
				     does not grow a permanently empty heading. -->
				{#if showElsewhere}
					<h4>Elsewhere</h4>
					{#each data.unassigned.slice(0, 12) as task (task.path + ':' + task.line)}
						<TaskRow
							{task}
							showPath
							draggable
							overdue={isOverdue(task)}
							onchange={applied}
							onproblem={failed}
							onopen={(t) => (opened = t)}
							onadd={addToDay}
						/>
					{/each}
					{#if data.unassigned.length > 12}
						<p class="hint">and {data.unassigned.length - 12} more</p>
					{/if}
				{/if}
				{#if !visibleGroups.length && !showElsewhere}
					<p class="hint">
						Nothing open in your workspaces. Add a card on a board and it appears here.
						<a href="/w">Your workspaces</a>
					</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if opened}
	<CardDrawer task={opened} onclose={() => (opened = null)} onchange={applied} />
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
		border-radius: var(--r-sm);
		padding: var(--s1) 9px;
		font-size: var(--t12);
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		box-shadow: var(--shadow);
	}
	.grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: var(--s4); align-items: start; }
	.main, .side { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
	/* The card form only: the conflict line above is the shared `.problem`. */
	.card.problem { border-color: #fca5a5; background: #fff7f7; margin-bottom: var(--s3); }
	details summary { cursor: pointer; font-size: var(--t12); text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	details[open] summary { margin-bottom: var(--s3); }

	/*
	 * The timeline card ends where the window does, and the grid scrolls
	 * inside it. `--day-chrome` is everything above and below the card that is
	 * not the card: the shell's header, this page's own header, the briefing
	 * strip, the padding `main` adds, and the card's heading and hint. The
	 * shell's share of it is `--header-h`, from app.css, rather than a second
	 * copy of the number; the rest is measured here.
	 */
	.day-timeline {
		--day-chrome: calc(var(--header-h) + 202px);
		display: flex;
		flex-direction: column;
		min-height: 320px;
		max-height: calc(100vh - var(--day-chrome));
		max-height: calc(100dvh - var(--day-chrome));
	}

	/* `.chip` and `.chips` are in app.css; only the spacing is this page's. */
	.chips { margin-bottom: 10px; }
	/* Under the heading rather than beside it: a chip per project is a row of
	   its own length, and crowding it in with the totals wraps the heading. */
	.by-workspace { flex: none; margin: -2px 0 10px; }
	i { width: var(--s2); height: var(--s2); border-radius: 50%; display: inline-block; }

	/* The three numbers a day is judged by, as pills rather than a sentence. */
	.chips.right { margin-bottom: 0; }
	.chip.over { color: var(--warn); }

	h4 {
		margin: var(--s3) 0 2px;
		font-size: var(--t12);
		color: var(--muted);
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.backlog { margin-bottom: var(--s4); }
	.backlog h4 { margin-top: 0; }
	.backlog .right { margin-left: auto; font-weight: 400; }
	.fenced { display: flex; gap: var(--s2); align-items: baseline; padding: 5px var(--s1); border-top: 1px solid var(--line); color: var(--muted); }
	.fenced .text { flex: 1; }

	/* Two columns, both on screen: the segmented control has nothing to do. */
	.segmented { display: none; }

	@media (max-width: 960px) {
		.grid { grid-template-columns: 1fr; }
	}

	@media (max-width: 720px) {
		.segmented {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--s1);
			margin: 0 0 var(--s3);
			padding: 3px;
			background: var(--soft);
			border-radius: var(--r-pill);
		}
		.segmented button {
			min-height: 36px;
			border: 0;
			border-radius: var(--r-pill);
			background: none;
			font: inherit;
			font-size: var(--t13);
			color: var(--muted);
			cursor: pointer;
		}
		.segmented [aria-selected='true'] { background: var(--panel); color: var(--text); font-weight: 600; }

		/* One column at a time, chosen above. */
		.grid .side { display: none; }
		.grid.showing-tasks .main { display: none; }
		.grid.showing-tasks .side { display: flex; }

		/*
		 * Taller here, and measured differently: the phone adds the segmented
		 * control and the bottom tab bar, whose height the shell publishes.
		 */
		.day-timeline { --day-chrome: calc(var(--header-h) + var(--tabbar-h) + 282px); }
	}
</style>

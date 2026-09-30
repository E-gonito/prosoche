<script lang="ts">
	/**
	 * The Today dashboard: one day's plan, and the week around it.
	 *
	 * Shared by `/today` and `/today/[day]`, which differ only in which day
	 * their `+page.server.ts` asks `loadToday` for. Everything below the title
	 * is the same component either way, so the two routes cannot drift into
	 * two slightly different dashboards.
	 */
	import { invalidateAll } from '$app/navigation';
	import Timeline from '$lib/components/Timeline.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import CardRow from '$lib/components/board/CardRow.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';
	import Capture from '$lib/components/Capture.svelte';
	import Briefing from '$lib/components/Briefing.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { editTask, planOnDay } from '$lib/client/api';
	import { displayText, type Task } from '$lib/shared/task';
	import { registerDropZone, drag } from '$lib/client/drag.svelte';
	import type { TodayData } from '$lib/shared/today';

	let { data }: { data: TodayData } = $props();

	// Edited tasks are held as a patch layer over the server's data rather than
	// copied into local state, for the same reason the old day page did: it
	// keeps server rendering intact, and a task moving between scheduled and
	// unscheduled falls out of the filters for free.
	let patches = $state(new Map<string, Task>());
	let problem = $state('');
	/** The card being edited, if any. */
	let opened = $state<Task | null>(null);

	const keyOf = (task: Task) => `${data.day}|${task.path}:${task.line}`;
	const ownerOf = (task: Task) => data.owners[`${task.path}:${task.line}`] ?? null;
	const overdueOwnerOf = (task: Task) => data.overdueOwners[`${task.path}:${task.line}`] ?? null;
	const merge = (list: Task[]) => list.map((task) => patches.get(keyOf(task)) ?? task);

	const all = $derived([...merge(data.scheduled), ...merge(data.unscheduled)]);
	const scheduled = $derived(all.filter((t) => t.startMin !== null).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0)));
	const unscheduled = $derived(all.filter((t) => t.startMin === null));

	const timelineEvents = $derived(data.events.map((e) => ({ id: e.id, title: e.title, startMin: e.startMin, endMin: e.endMin })));
	const allDayEvents = $derived(data.events.filter((e) => e.startMin === null));

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
	 * Which of the two the phone is showing: the timeline or the list.
	 * Meaningless on a wide screen, where both are on screen at once.
	 */
	type Segment = 'timeline' | 'list';
	let segment = $state<Segment>('timeline');
	// A remembered choice wins. Without one, a day with nothing on the clock
	// opens on the list, because an empty timeline is a screenful of nothing.
	$effect(() => {
		const stored = localStorage.getItem('hub:today-segment');
		if (stored === 'list' || (stored === null && data.scheduled.length === 0 && data.events.length === 0)) segment = 'list';
	});
	function show(next: Segment) {
		segment = next;
		localStorage.setItem('hub:today-segment', next);
	}

	async function clearTime(task: Task) {
		if (task.startMin === null) return;
		const result = await editTask(task, { time: null });
		if (result.ok) applied(result.value);
		else failed(result.message);
	}

	/**
	 * Add a card to the real today with no time on it — "Add to today" from a
	 * workspace's list, "Plan for today" from Overdue. The same action either
	 * way: a block with no time, ready to be dragged onto the timeline.
	 */
	async function addToToday(task: Task) {
		problem = '';
		const result = await planOnDay(data.today, task);
		if (result.ok) await invalidateAll();
		else failed(result.message);
	}
</script>

<svelte:head><title>{data.label} · prosoche</title></svelte:head>

<div class="page wide today">
	<div class="title">
		<h1 data-testid="today-title">{data.label}</h1>
		<p class="sub">
			<a class="btn ghost small" href="/today/{data.prev}" aria-label="Previous day"><Icon name="chevron-left" size={14} /></a>
			<span class="relative">{data.relative}</span>
			<a class="btn ghost small" href="/today/{data.next}" aria-label="Next day"><Icon name="chevron-right" size={14} /></a>
			{#if !data.isToday}<a class="btn small" href="/today">Today</a>{/if}
		</p>
		<p class="summary" data-testid="today-summary">{data.summary}</p>
	</div>

	{#if problem}<p class="problem" role="status">{problem}</p>{/if}
	{#if data.conflicted}
		<p class="problem" data-testid="conflict">
			This note has git conflict markers. Resolve it in Obsidian or on the <a href="/sync">sync page</a>.
		</p>
	{/if}

	<Briefing day={data.day} text={data.briefingText} isToday={data.isToday} aiEnabled={data.aiEnabled} />

	<div class="grid">
		<div class="main">
			<p class="label">Today</p>

			{#if !data.exists}
				<div class="sheet">
					<div class="empty">
						<p><b>{data.isToday ? 'Today’s note is not here yet.' : 'No note for this day.'}</b></p>
						<p>Daily notes are made in Obsidian. Open the day there, and it shows here once it has synced.</p>
					</div>
				</div>
			{:else}
				<div class="segmented" data-testid="today-segment" role="tablist" aria-label="What to show">
					<button role="tab" aria-selected={segment === 'timeline'} data-testid="segment-timeline" onclick={() => show('timeline')}>
						Timeline
					</button>
					<button role="tab" aria-selected={segment === 'list'} data-testid="segment-list" onclick={() => show('list')}>
						List
					</button>
				</div>

				<div class="split" class:showing-list={segment === 'list'}>
					<div class="timeline-side">
						{#if allDayEvents.length}
							<div class="chips all-day">
								{#each allDayEvents as event (event.id)}
									<span class="chip quiet"><Icon name="calendar" size={12} />{event.title}</span>
								{/each}
							</div>
						{/if}
						{#if data.calendarProblem}<p class="hint">{data.calendarProblem}</p>{/if}
						<div class="sheet timeline-card">
							{#key data.day + segment}
								<Timeline
									tasks={scheduled}
									events={timelineEvents}
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
					</div>

					<div class="list-side" data-testid="unscheduled" class:receiving={drag.task !== null && drag.task.startMin !== null} bind:this={unscheduledCard}>
						<div class="sheet">
							<h3>Unscheduled <span class="right num">{unscheduled.length}</span></h3>
							<Capture onproblem={failed} />
							<div class="rows">
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
							</div>
							{#if unscheduled.length}
								<p class="hint">Drag the ⠿ grip onto the timeline to give one a time.</p>
							{:else}
								<p class="hint">Drag a block off the timeline onto this card to take its time off.</p>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			{#if data.overdue.length || data.overdueCards.length}
				<p class="label">Overdue <span class="right num">{data.overdue.length + data.overdueCards.length}</span></p>
				<div class="sheet rows" data-testid="overdue">
					{#each data.overdueCards as card (card.path + ':' + card.line)}
						<CardRow {card} today={data.today} showWorkspace onproblem={failed} />
					{/each}
					{#each data.overdue as task (task.path + ':' + task.line)}
						<TaskRow
							{task}
							showPath
							overdue
							workspace={overdueOwnerOf(task)}
							onopen={(t) => (opened = t)}
							onadd={addToToday}
						/>
					{/each}
				</div>
			{/if}
		</div>

		<div class="side">
			{#if data.workspaces.length}
				<p class="label">From your workspaces</p>
				<div class="workspaces" data-testid="today-workspaces">
					{#each data.workspaces as group (group.slug)}
						<div class="sheet" data-testid="workspace-card">
							<h3><i style="background: {group.color}"></i>{group.name} {#if group.inboxCount}<span class="right muted small">{group.inboxCount} in inbox</span>{/if}</h3>
							<div class="rows">
								{#each group.cards as card (card.path + ':' + card.line)}
									<CardRow {card} today={data.today} onproblem={failed} />
								{/each}
							</div>
							{#if group.more}<p class="hint">and {group.more} more</p>{/if}
							{#if !group.cards.length}<p class="none">Nothing open.</p>{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if data.cards.length}
				<p class="label">More</p>
				{#each data.cards as card (card.module)}
					<div class="sheet" data-testid="module-card" data-module={card.module}>
						<h3>{card.title}</h3>
						<div class="rows">
							{#each card.items as item, i (i)}
								{#if item.href}
									<a class="module-item" href={item.href}>
										<span>{item.text}</span>
										{#if item.meta}<span class="muted small">{item.meta}</span>{/if}
									</a>
								{:else}
									<div class="module-item">
										<span>{item.text}</span>
										{#if item.meta}<span class="muted small">{item.meta}</span>{/if}
									</div>
								{/if}
							{/each}
						</div>
						<a class="hint" href={card.href}>Open</a>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>

{#if opened}
	<CardDrawer task={opened} onclose={() => (opened = null)} onchange={applied} />
{/if}

{#if drag.task}
	<div class="drag-ghost" style="left: {drag.x + 12}px; top: {drag.y - 10}px">{displayText(drag.task.text)}</div>
{/if}

<style>
	/* The columns follow the page's own width, not the window's: the rail
	   takes its share first, so a portrait monitor at 1200px has the room of
	   a small laptop, and a viewport query would squeeze three columns in. */
	.today { container-type: inline-size; }
	.today .title { margin-bottom: var(--s3); }
	.sub { display: flex; align-items: center; gap: var(--s2); margin: var(--s1) 0 0; color: var(--muted); font-size: var(--t14); }
	.sub .relative { text-transform: capitalize; }
	.summary { margin: var(--s1) 0 0; color: var(--muted); font-size: var(--t14); }
	.problem { color: var(--bad); font-size: var(--t13); margin: var(--s2) 0; }

	.grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: var(--s5); align-items: start; margin-top: var(--s3); }
	.main, .side { display: flex; flex-direction: column; min-width: 0; }

	.segmented { display: none; }
	.split { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--s4); align-items: start; }
	.timeline-side, .list-side { display: flex; flex-direction: column; gap: var(--s2); min-width: 0; }
	.timeline-card {
		--today-chrome: calc(var(--header-h) + 260px);
		display: flex;
		flex-direction: column;
		min-height: 320px;
		max-height: calc(100vh - var(--today-chrome));
		max-height: calc(100dvh - var(--today-chrome));
		padding: var(--s3);
	}
	.all-day { margin-bottom: 0; }
	.receiving { outline: 2px dashed var(--accent); outline-offset: -2px; border-radius: var(--r-lg); }

	h3 {
		margin: 0 0 var(--s2);
		font: 600 var(--t12)/1.2 var(--sans);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	h3 .right { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; }
	h3 i { width: var(--s2); height: var(--s2); border-radius: 50%; display: inline-block; }

	.workspaces { display: flex; flex-direction: column; gap: var(--s3); margin-bottom: var(--s3); }
	.module-item { display: flex; justify-content: space-between; gap: var(--s2); padding: 6px 0; color: var(--text); }
	a.module-item:hover { color: var(--accent); }

	/* Named `.drag-ghost` rather than `.ghost`, which the shared `.btn.ghost`
	   variant already uses — the two collided under Svelte's scoping, since a
	   scoped selector still matches by class token, not by the whole string. */
	.drag-ghost {
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

	/* Too narrow for a side column: the workspaces move under the day and lay
	   out across the page instead of down it. */
	@container (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; }
		.workspaces { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
	}

	@container (max-width: 640px) {
		.split { grid-template-columns: 1fr; }
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

		.split { display: block; }
		.split .list-side { display: none; }
		.split.showing-list .timeline-side { display: none; }
		.split.showing-list .list-side { display: block; }

		.timeline-card { --today-chrome: calc(var(--header-h) + var(--tabbar-h) + 300px); }
	}
</style>

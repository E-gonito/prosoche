<script lang="ts">
	/**
	 * The Today dashboard: one day's plan.
	 *
	 * Rendered by `/today/[[day]]` for `/today` and `/today/<day>` alike,
	 * which differ only in which day the load asks `loadToday` for.
	 */
	import { invalidateAll } from '$app/navigation';
	import Timeline from '$lib/components/Timeline.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import CardRow from '$lib/components/board/CardRow.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';
	import Capture from '$lib/components/Capture.svelte';
	import ScheduleSheet from '$lib/components/ScheduleSheet.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { api, editTask, planOnDay } from '$lib/client/api';
	import { displayText, type Task } from '$lib/shared/task';
	import { formatMinutes } from '$lib/shared/time';
	import { cardAsTask } from '$lib/shared/kanban';
	import { firstFree } from '$lib/client/layout';
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
			// A task from another note (a board card) is planned onto the day
			// with no time; one already in the day's note loses its time.
			drop: (task) => void (task.path === data.path ? clearTime(task) : planHere(task))
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

	async function planHere(task: Task) {
		problem = '';
		const result = await planOnDay(data.day, task);
		if (result.ok) await invalidateAll();
		else failed(result.message);
	}

	/**
	 * Inbox lines shown whole, by line number. Every line starts cut to one
	 * row, so a pasted URL takes no more room than a word; a tap opens it.
	 */
	let openLines = $state(new Set<number>());
	function toggleLine(line: number) {
		const next = new Set(openLines);
		if (!next.delete(line)) next.add(line);
		openLines = next;
	}

	let creating = $state(false);
	/** The one way a daily note is made here: a press of this button. */
	async function createNote() {
		creating = true;
		const result = await api<{ path: string; fromTemplate: boolean }>(`/api/day/${data.day}/note`, {});
		creating = false;
		if (!result.ok) return failed(result.message);
		problem = result.value.fromTemplate ? '' : `There was no journal template, so ${result.value.path} holds only a # Tasks heading.`;
		await invalidateAll();
	}

	/**
	 * Giving a time by tapping rather than dragging: the sheet, and what it
	 * was opened with. `task` null is "what goes at this time?", from a tap
	 * on an empty stretch of the timeline; a timed task is a block tapped to
	 * change it; an untimed one is a row's clock button.
	 */
	let sheet = $state<{ task: Task | null; startMin: number; duration: number } | null>(null);
	/** Said once a time is written, since on a phone the timeline may be on the other tab. */
	let notice = $state('');

	/** Where a new block is offered: the first free stretch from now on today, from 09:00 on any other day. */
	function offeredStart(duration: number): number {
		const now = new Date();
		const from = data.isToday ? now.getHours() * 60 + now.getMinutes() : 9 * 60;
		const taken = scheduled.map((t) => ({ startMin: t.startMin!, endMin: t.endMin! }));
		return firstFree(taken, from, duration);
	}

	function scheduleTask(task: Task) {
		sheet = { task, startMin: offeredStart(30), duration: 30 };
	}

	function changeBlock(task: Task) {
		sheet = { task, startMin: task.startMin ?? offeredStart(30), duration: (task.endMin ?? 0) - (task.startMin ?? 0) || 30 };
	}

	/** What a tap on an empty time can place: the day's own tasks first, then each workspace's open cards. */
	const choices = $derived([
		{ title: 'Unscheduled', tasks: unscheduled.filter((t) => t.status === 'todo' || t.status === 'in-progress') },
		...data.workspaces.map((group) => ({ title: group.name, tasks: group.cards.map(cardAsTask) }))
	]);

	/**
	 * Write a time for `task`. One already in the day's note has the time put
	 * on its own line; a card from anywhere else is planned onto the day as a
	 * block at that time, as dropping it on the timeline does. Answers a
	 * problem to show, or null.
	 */
	async function place(task: Task, startMin: number, endMin: number): Promise<string | null> {
		const range = `${formatMinutes(startMin)}–${formatMinutes(endMin % 1440)}`;
		if (task.path === data.path) {
			const result = await editTask(task, { time: { start: formatMinutes(startMin), end: formatMinutes(endMin % 1440) } });
			if (!result.ok) return result.message;
			applied(result.value);
		} else {
			const result = await planOnDay(data.day, task, { startMin, endMin });
			if (!result.ok) return result.message;
			await invalidateAll();
		}
		notice = `${displayText(task.text)}: ${range}.`;
		return null;
	}

	async function unplace(task: Task): Promise<string | null> {
		const result = await editTask(task, { time: null });
		if (!result.ok) return result.message;
		applied(result.value);
		notice = `${displayText(task.text)}: no time.`;
		return null;
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
		<p class="summary">
			<span data-testid="today-summary">{data.summary}</span>
			{#if data.offerReview}· <a data-testid="review-link" href={data.isToday ? '/today/review' : `/today/${data.day}/review`}>Review the day</a>{/if}
		</p>
	</div>

	{#if problem}<p class="problem" role="status">{problem}</p>{/if}
	{#if notice}<p class="notice small" role="status" data-testid="schedule-notice">{notice}</p>{/if}
	{#if data.conflicted}
		<p class="problem" data-testid="conflict">
			This note has git conflict markers. Resolve it in Obsidian or on the <a href="/sync">sync page</a>.
		</p>
	{/if}

	<!-- Always shown: its capture row is where a thought goes, whether or not anything is waiting. -->
	<div class="sheet inbox-card" data-testid="today-inbox">
		<h3 class="caps">Inbox {#if data.inbox.count}<a class="right small" href="/inbox">{data.inbox.count} to triage</a>{/if}</h3>
		<Capture oncaptured={() => invalidateAll()} onproblem={failed} />
		{#if data.inbox.lines.length}
			<div class="rows">
				{#each data.inbox.lines as line (line.line)}
					<button
						class="inbox-line"
						class:open={openLines.has(line.line)}
						aria-expanded={openLines.has(line.line)}
						onclick={() => toggleLine(line.line)}
						data-testid="inbox-line"
					>{#if line.stamp}<span class="num muted">{line.stamp}</span>{" "}{/if}{displayText(line.text)}</button>
				{/each}
			</div>
			{#if data.inbox.count > data.inbox.lines.length}<p class="hint more-lines">and {data.inbox.count - data.inbox.lines.length} more</p>{/if}
		{/if}
	</div>

	<div class="grid">
		<div class="main">
			<p class="label">Today</p>

			{#if !data.exists}
				<div class="sheet">
					<div class="empty big" data-testid="no-note">
						<h2>{data.isToday ? 'Today’s note is not here yet' : 'No note for this day'}</h2>
						<p class="muted">Create <code>{data.path}</code> from your journal template, or open the day in Obsidian.</p>
						<button class="btn primary" data-testid="create-note" disabled={creating} onclick={createNote}>
							{creating ? 'Creating…' : data.isToday ? 'Create today’s note' : 'Create this day’s note'}
						</button>
						<div class="prose" data-testid="task-grammar">
							<pre><code>- [ ] 09:30 - 10:00 Text `Q1`</code></pre>
						</div>
						<p class="hint"><code>[x]</code> done, <code>[-]</code> skipped; the time and <code>Q1</code> are optional.</p>
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
							<button class="btn small add-block" onclick={() => (sheet = { task: null, startMin: offeredStart(30), duration: 30 })} data-testid="add-block">
								<Icon name="plus" size={14} /> Put a task on the timeline
							</button>
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
									onopen={changeBlock}
									onslot={(minute) => (sheet = { task: null, startMin: minute, duration: 30 })}
								/>
							{/key}
						</div>
					</div>

					<div class="list-side" data-testid="unscheduled" class:receiving={drag.task !== null && (drag.task.startMin !== null || drag.task.path !== data.path)} bind:this={unscheduledCard}>
						<div class="sheet">
							<h3 class="caps">Unscheduled <span class="right num">{unscheduled.length}</span></h3>
							<Capture day={data.day} oncaptured={() => invalidateAll()} onproblem={failed} />
							<div class="rows">
								{#each unscheduled as task (task.path + ':' + task.line)}
									<TaskRow
										{task}
										draggable
										workspace={ownerOf(task)}
										onchange={applied}
										onproblem={failed}
										onopen={(t) => (opened = t)}
										onschedule={scheduleTask}
									/>
								{/each}
							</div>
							{#if unscheduled.length}
								<p class="hint fine">Drag the ⠿ grip onto the timeline, or use the clock, to give one a time.</p>
								<p class="hint coarse">Tap the clock to give one a time.</p>
							{:else}
								<p class="hint fine">Drag a block off the timeline onto this card to take its time off.</p>
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
							<h3 class="caps"><i class="dot" style="--dot: {group.color}"></i>{group.name} {#if group.inboxCount}<a class="right muted small" href="/w/{group.slug}/inbox">{group.inboxCount} in inbox</a>{/if}</h3>
							<div class="rows scroll">
								{#each group.cards as card (card.path + ':' + card.line)}
									<CardRow {card} today={data.today} draggable={data.exists} onschedule={data.exists ? scheduleTask : undefined} onproblem={failed} />
								{/each}
							</div>
							{#if !group.cards.length}<p class="empty">Nothing open.</p>{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if data.cards.length}
				<p class="label">More</p>
				{#each data.cards as card (card.module)}
					<div class="sheet" data-testid="module-card" data-module={card.module}>
						<h3 class="caps">{card.title}</h3>
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

{#if sheet}
	<ScheduleSheet
		task={sheet.task}
		startMin={sheet.startMin}
		duration={sheet.duration}
		{choices}
		onsave={place}
		onunschedule={unplace}
		onedit={sheet.task?.startMin != null
			? (task) => {
					sheet = null;
					opened = task;
				}
			: undefined}
		onclose={() => (sheet = null)}
	/>
{/if}

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
	.add-block { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; margin-bottom: var(--s2); }
	.notice { margin: 0 0 var(--s3); color: var(--muted); }
	.hint.coarse { display: none; }
	@media (pointer: coarse) {
		.hint.fine { display: none; }
		.hint.coarse { display: block; }
	}
	.receiving { outline: 2px dashed var(--accent); outline-offset: -2px; border-radius: var(--r-lg); }

	h3 {
		margin: 0 0 var(--s2);
		display: flex;
		align-items: center;
		gap: var(--s2);
	}
	h3 .right { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; }

	.inbox-card { margin-bottom: var(--s4); }
	.inbox-line {
		display: block;
		width: 100%;
		padding-left: 0;
		padding-right: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: var(--t13);
		color: var(--text);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.inbox-line + .inbox-line { border-top: 1px solid var(--line); }
	.inbox-line.open { white-space: normal; overflow-wrap: anywhere; }
	.workspaces { display: flex; flex-direction: column; gap: var(--s3); margin-bottom: var(--s3); }
	/* Every open card is here; past three and a half rows the list scrolls,
	   the half row showing there is more below. */
	.workspaces .scroll { max-height: 145px; overflow-y: auto; overscroll-behavior: contain; }
	.module-item { display: flex; justify-content: space-between; gap: var(--s2); padding: 6px 0; color: var(--text); }
	a.module-item:hover { color: var(--accent); }

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
		/* A long line, such as a study step, keeps the width; what it says about itself goes under it. */
		.module-item { flex-direction: column; gap: 2px; }
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

		/* Most of the screen: the timeline is what this tab is for, and the page scrolls past it to the rest. */
		.timeline-card { height: 72vh; height: 72dvh; max-height: none; min-height: 0; }
		/* The inbox's newest two, so the day itself is on the first screen; "to triage" has the rest. */
		.inbox-line:nth-child(n + 3), .more-lines { display: none; }
		.add-block { align-self: stretch; justify-content: center; min-height: 44px; font-size: var(--t14); }
	}
</style>

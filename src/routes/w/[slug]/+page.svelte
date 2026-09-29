<script lang="ts">
	/**
	 * A workspace's overview: what to do next, what came in, what happened
	 * last, what is stuck, and where the notes are.
	 *
	 * Every section links to the tab that goes deeper, so this page is a
	 * summary rather than a second place to do the work.
	 */
	import TaskRow from '$lib/components/board/TaskRow.svelte';
	import CardDrawer from '$lib/components/CardDrawer.svelte';
	import { noteHref } from '$lib/shared/links';
	import { displayText, type Task } from '$lib/shared/task';

	let { data } = $props();

	let opened = $state<Task | null>(null);
	let patched = $state<Record<string, Task>>({});

	const nextActions = $derived(data.nextActions.map((t: Task) => patched[`${t.path}:${t.line}`] ?? t));
	const slug = $derived(data.workspace?.slug);
</script>

<section>
	<p class="label">Next actions <span class="right"><a href="tasks">Tasks</a></span></p>
	<div class="sheet rows">
		{#each nextActions as task (`${task.path}:${task.line}`)}
			<TaskRow {task} onopen={(t) => (opened = t)} onchange={(t) => (patched = { ...patched, [`${t.path}:${t.line}`]: t })} />
		{:else}
			<p class="none">Nothing open. A card shows here once one has a quadrant, a due date or the workspace's tag.</p>
		{/each}
	</div>
</section>

{#if data.blocked.length}
	<section>
		<p class="label">Blocked <span class="right">{data.blocked.length}</span></p>
		<div class="sheet rows">
			{#each data.blocked as card (`${card.task.path}:${card.task.line}`)}
				<div class="blocked-row">
					<span class="text">{displayText(card.task.text)}</span>
					<span class="muted small">waiting on {card.blockers.map((b: { id: string; task: Task | null }) => (b.task ? displayText(b.task.text) : b.id)).join(', ')}</span>
				</div>
			{/each}
		</div>
	</section>
{/if}

<div class="split">
	<section>
		<p class="label">Inbox <span class="right"><a href="inbox">Inbox</a></span></p>
		<div class="sheet rows">
			{#each data.inboxPreview as line (line)}
				<p class="capture">{line.replace(/^[ \t]*[-*+][ \t]+/, '')}</p>
			{:else}
				<p class="none">Nothing captured yet.</p>
			{/each}
		</div>
	</section>

	<section>
		<p class="label">Log <span class="right"><a href="log">Log</a></span></p>
		{#if data.latestLog}
			<div class="sheet rows">
				<p class="day">{data.latestLog.day}</p>
				{#each data.latestLog.lines as line (line)}
					<p class="capture">{line.replace(/^[ \t]*[-*+][ \t]+/, '')}</p>
				{/each}
			</div>
		{:else}
			<div class="sheet rows"><p class="none">No sessions logged yet.</p></div>
		{/if}
	</section>
</div>

<section>
	<p class="label">Recent notes <span class="right"><a href="notes">Notes</a></span></p>
	<div class="sheet rows">
		{#each data.notes as note (note.path)}
			<a class="row" href={noteHref(note.path)}>
				<span>{note.title}</span>
				<span class="muted small">{note.day}</span>
			</a>
		{:else}
			<p class="none">No notes in this workspace's folders yet.</p>
		{/each}
	</div>
</section>

<section>
	<p class="label">Meetings</p>
	<p><a href={data.meetingsHref}>Open {slug}'s meeting notebook</a></p>
</section>

{#if opened}
	<CardDrawer task={opened} onclose={() => (opened = null)} onchange={(t) => (patched = { ...patched, [`${t.path}:${t.line}`]: t })} />
{/if}

<style>
	section { margin-bottom: var(--s5); }
	.split { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s5); }
	.day { margin: 0; padding: var(--s2) var(--s1) 0; font: 600 var(--t12) inherit; color: var(--muted); }
	.capture { margin: 0; padding: var(--s1); font-size: var(--t13); border-top: 1px solid var(--line); }
	.capture:first-of-type { border-top: 0; }
	.blocked-row { display: flex; flex-direction: column; gap: 2px; padding: var(--s2) var(--s1); border-top: 1px solid var(--line); font-size: var(--t13); }
	.blocked-row:first-child { border-top: 0; }
	.row { display: flex; justify-content: space-between; gap: var(--s2); padding: var(--s2) var(--s1); border-top: 1px solid var(--line); color: var(--text); }
	.row:first-child { border-top: 0; }
	.row:hover { text-decoration: none; background: var(--soft); }

	@media (max-width: 720px) {
		.split { grid-template-columns: 1fr; }
	}
</style>

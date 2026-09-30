<script lang="ts">
	/**
	 * A workspace's inbox: capture here, then either tick it (it was already a
	 * task) or make it one (it was just a thought).
	 *
	 * Nothing here ever deletes a line: ticking a plain capture only adds a
	 * checkbox to it, and "make it a task" copies its words onto the board's
	 * first column rather than moving them.
	 */
	import { invalidateAll } from '$app/navigation';
	import Capture from '$lib/components/Capture.svelte';
	import TaskRow from '$lib/components/TaskRow.svelte';
	import { api, editTask } from '$lib/client/api';
	import type { Task } from '$lib/shared/task';

	let { data } = $props();

	let problem = $state('');
	let filing = $state<number | null>(null);

	async function toggleTask(task: Task) {
		const result = await editTask(task, { status: task.status === 'done' ? 'todo' : 'done' });
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	async function makeTask(line: { line: number; raw: string }) {
		if (filing !== null) return;
		filing = line.line;
		const result = await api('/api/inbox', { workspace: data.workspace.slug, line: line.line, expectedRaw: line.raw });
		filing = null;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		problem = '';
		await invalidateAll();
	}
</script>

<p class="label">Capture</p>
<Capture workspace={data.workspace.slug} onproblem={(m) => (problem = m)} />

{#if problem}<p class="problem">{problem}</p>{/if}

<p class="label">Inbox <span class="right">{data.inbox.lines.filter((l) => !l.done).length} open</span></p>
<div class="sheet rows">
	{#each data.inbox.lines as line (line.line)}
		<div class="row">
			{#if line.task}
				<div class="task-cell"><TaskRow task={line.task} onchange={() => invalidateAll()} onproblem={(m) => (problem = m)} /></div>
			{:else}
				<span class="bullet" class:done={line.done}>{line.text}</span>
			{/if}
			{#if !line.done}
				<button class="btn ghost small" disabled={filing === line.line} onclick={() => makeTask(line)}>
					{filing === line.line ? 'Filing…' : 'Make it a task'}
				</button>
			{/if}
		</div>
	{:else}
		<p class="none">Nothing captured yet.</p>
	{/each}
</div>

<style>
	.row { display: flex; align-items: center; gap: var(--s2); padding: var(--s1) var(--s2); border-top: 1px solid var(--line); }
	.row:first-child { border-top: 0; }
	.task-cell { flex: 1; min-width: 0; }
	.task-cell :global(.task) { border-top: 0; padding: 0; }
	.bullet { flex: 1; min-width: 0; padding: 7px 0; font-size: var(--t14); }
	.bullet.done { text-decoration: line-through; color: var(--muted); }
	.problem { font-size: var(--t12); color: var(--bad); }
</style>

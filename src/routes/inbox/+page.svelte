<script lang="ts">
	/**
	 * Inbox triage: each captured line leaves by one of three doors, and the
	 * list is done when it is empty. Grouped by the day it was captured,
	 * newest first.
	 */
	import InboxRows from '$lib/components/InboxRows.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
	let problem = $state('');
</script>

<svelte:head><title>Inbox · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Inbox</h1>
		<p class="sub"><span class="num">{data.lines.length}</span> to triage in <a href={noteHref(data.path)}><code>{data.path}</code></a></p>
	</div>

	{#if problem}<p class="problem" role="status">{problem}</p>{/if}
	{#if !data.todayExists && data.lines.length}
		<p class="hint">Today has no note yet, so <b>Today</b> cannot plan anything. <a href="/today">Create it on Today</a>.</p>
	{/if}

	<InboxRows lines={data.lines} workspaces={data.workspaces} owners={data.owners} byDay onproblem={(m) => (problem = m)} />

	{#if data.lines.length}
		<p class="hint keys">Focus a row, then <kbd>t</kbd> plans it onto today, <kbd>b</kbd> files it on a board, <kbd>x</kbd> drops it. Every line is ticked, never deleted.</p>
	{/if}
</div>

<style>
	.sub { margin: var(--s1) 0 0; color: var(--muted); font-size: var(--t14); }
	.keys { margin-top: var(--s4); }
	kbd { font-family: var(--mono); font-size: var(--t12); padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); }
</style>

<script lang="ts">
	/**
	 * Start a block: what it is, and one button. The button commits to a few
	 * minutes, not the block, and says so. A block that is not an open, timed
	 * line any more is said plainly, with the way back to Today.
	 */
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import { formatMinutes } from '$lib/shared/time';
	import { justMinutes } from '$lib/shared/focus';

	let { data } = $props();

	let busy = $state(false);
	let problem = $state('');

	async function start() {
		if (!data.block) return;
		busy = true;
		problem = '';
		const result = await api('/api/focus', { action: 'start', day: data.day, line: data.block.line, raw: data.block.raw });
		if (result.ok) await goto('/focus', { invalidateAll: true });
		else {
			problem = result.message;
			busy = false;
		}
	}
</script>

<svelte:head><title>Start · prosoche</title></svelte:head>

<div class="page narrow">
	<section class="card" data-testid="focus-start">
		{#if data.block}
			<p class="caps num" data-testid="start-time">{formatMinutes(data.block.startMin)} - {formatMinutes(data.block.endMin)}</p>
			<h1 data-testid="start-text">{data.block.text}</h1>
			{#if data.busy}
				<p class="problem" role="status">Finish "{data.busy}" first.</p>
				<a class="btn primary go" href="/focus">Go to it</a>
			{:else}
				<button class="btn primary go" disabled={busy} onclick={start} data-testid="start-block">Start</button>
				<p class="muted">{justMinutes(data.warmupMin)}. After that, the rest of the block.</p>
			{/if}
			{#if problem}<p class="problem" role="status">{problem}</p>{/if}
		{:else}
			<h1>That block is not open any more</h1>
			<p class="muted" data-testid="start-gone">It was moved, ticked, or has no start and end time.</p>
			<a class="btn primary" href="/today">Today</a>
		{/if}
	</section>
</div>

<style>
	.narrow { max-width: 640px; }
	.card { padding: var(--s6) var(--s5); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); }
	.caps { margin: 0; color: var(--muted); font-size: var(--t13); }
	h1 { margin: var(--s2) 0 var(--s4); font: 600 var(--t20)/1.35 var(--serif); }
	.go { display: flex; width: 100%; min-height: 72px; align-items: center; justify-content: center; font-size: var(--t20); }
	.muted { margin: var(--s3) 0 0; color: var(--muted); }
</style>

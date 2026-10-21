<script lang="ts">
	/**
	 * The focus view: the timer, the step, the smallest way to begin it, a
	 * scratch box, and the ways to stop. Nothing else is on the page. Ending
	 * asks the one question (Done, Made progress, Didn't get to it) and the
	 * server writes the outcome to the day's note.
	 */
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import type { Outcome } from '$lib/shared/study';

	let { data } = $props();

	const base = $derived(`/study/${data.subject.slug}`);
	const session = $derived(data.session);

	// The device's clock may be off; the server's is what the block was set by.
	let skew = $state(0);
	$effect(() => {
		skew = data.serverNow - Date.now();
	});
	let now = $state(Date.now());
	onMount(() => {
		const timer = setInterval(() => (now = Date.now() + skew), 1000);
		now = Date.now() + skew;
		return () => clearInterval(timer);
	});

	const left = $derived(session.startedAt + session.minutes * 60_000 - now);
	const clock = $derived.by(() => {
		const s = Math.floor(Math.abs(left) / 1000);
		return `${left < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	// Kept per session, so a reload does not lose what was typed.
	const key = $derived(`study-scratch-${session.startedAt}`);
	let scratch = $state('');
	onMount(() => (scratch = sessionStorage.getItem(key) ?? ''));
	$effect(() => sessionStorage.setItem(key, scratch));

	let busy = $state(false);
	let problem = $state('');
	let ended = $state<{ minutes: number; outcome: Outcome; warnings: string[] } | null>(null);

	async function extend() {
		busy = true;
		const result = await api('/api/study/session', { action: 'extend', minutes: 15 });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	async function end(outcome: Outcome) {
		busy = true;
		problem = '';
		const result = await api<{ minutes: number; outcome: Outcome; warnings: string[] }>('/api/study/session', { action: 'end', subject: data.subject.slug, outcome, note: scratch });
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		sessionStorage.removeItem(key);
		if (result.value.warnings.length) ended = result.value;
		else await goto(base, { invalidateAll: true });
	}

	const pieces = (text: string) => text.split(/(`[^`]+`)/).filter(Boolean).map((p) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? { code: true, text: p.slice(1, -1) } : { code: false, text: p }));
</script>

<svelte:head><title>{clock} · {data.subject.name} · prosoche</title></svelte:head>

<div class="page narrow">
	{#if ended}
		<section class="card" data-testid="ended">
			<h1>Logged {ended.minutes} min</h1>
			{#each ended.warnings as warning (warning)}<p class="problem" role="status">{warning}</p>{/each}
			<a class="btn primary" href={base}>Back</a>
		</section>
	{:else}
		<section class="card" data-testid="session">
			<p class="caps"><i class="dot" style="--dot: {data.subject.color}"></i>{data.subject.name}</p>
			<p class="clock num" class:over={left < 0} data-testid="clock" aria-live="off">{clock}</p>
			<h1 data-testid="session-step">{#each pieces(session.step.text) as piece, i (i)}{#if piece.code}<code>{piece.text}</code>{:else}{piece.text}{/if}{/each}</h1>
			{#if session.step.first}<p class="start"><b>Start with:</b> {#each pieces(session.step.first) as piece, i (i)}{#if piece.code}<code>{piece.text}</code>{:else}{piece.text}{/if}{/each}</p>{/if}

			<textarea class="field" rows="4" bind:value={scratch} placeholder="Scratch: what you tried, what got stuck" aria-label="Scratch" data-testid="scratch"></textarea>

			<div class="row">
				<button class="btn" disabled={busy} onclick={extend} data-testid="extend">+15 min</button>
			</div>
			<p class="label">How did it go?</p>
			<div class="row">
				<button class="btn primary" disabled={busy} onclick={() => end('done')} data-testid="end-done">Done</button>
				<button class="btn" disabled={busy} onclick={() => end('progress')} data-testid="end-progress">Made progress</button>
				<button class="btn" disabled={busy} onclick={() => end('skipped')} data-testid="end-skipped">Didn't get to it</button>
			</div>
			{#if problem}<p class="problem" role="status">{problem}</p>{/if}
		</section>
	{/if}
</div>

<style>
	.narrow { max-width: 640px; }
	.card { padding: var(--s6) var(--s5); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); }
	.caps { display: flex; align-items: center; gap: var(--s2); margin: 0; color: var(--muted); font-size: var(--t13); }
	.clock { margin: var(--s2) 0 var(--s4); font: 600 56px/1 var(--serif); }
	.clock.over { color: var(--warn); }
	h1 { margin: 0 0 var(--s3); font: 600 var(--t20)/1.35 var(--serif); }
	.start { margin: 0 0 var(--s4); line-height: 1.5; }
	textarea { width: 100%; margin-bottom: var(--s3); resize: vertical; }
	.row { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.row .btn { min-height: 44px; }
</style>

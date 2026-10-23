<script lang="ts">
	/**
	 * The focus view: the running session's timer, its block, the smallest way to
	 * begin it, a scratch box, and the ways to stop. Nothing else is on the page.
	 *
	 * Start commits to the warm-up only. While it runs the clock counts the
	 * warm-up down under "Just five minutes"; at zero one soft chime plays and
	 * the clock becomes the block's time left, going `+m:ss` in the warning
	 * colour once it is past. Nothing is asked at minute five. Ending asks the
	 * one question (Done, Made progress, Didn't get to it) and the server writes
	 * the outcome to the day's note.
	 */
	import { onMount } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import StepText from '$lib/components/StepText.svelte';
	import { api } from '$lib/client/api';
	import { justMinutes } from '$lib/shared/focus';
	import { formatMinutes } from '$lib/shared/time';
	import type { Outcome } from '$lib/shared/study';

	let { data } = $props();

	const session = $derived(data.session);
	const block = $derived(session.block);
	const name = $derived(session.kind === 'study' ? session.name : session.block.text);
	const range = $derived(block && block.startMin !== null && block.endMin !== null ? `${formatMinutes(block.startMin)} - ${formatMinutes(block.endMin)}` : null);

	// The device's clock may be off; the server's is what the block was set by.
	let skew = $state(0);
	$effect(() => {
		skew = data.serverNow - Date.now();
	});
	let now = $state(Date.now());

	const warmupLeft = $derived(session.startedAt + session.warmupMin * 60_000 - now);
	const warming = $derived(warmupLeft > 0);
	const left = $derived(session.startedAt + session.minutes * 60_000 - now);
	const shown = $derived(warming ? warmupLeft : left);
	const clock = $derived.by(() => {
		const s = shown >= 0 ? Math.ceil(shown / 1000) : Math.floor(-shown / 1000);
		return `${shown < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	/** One soft sine tone. Silent if audio is unavailable, blocked, or the page is hidden. */
	function chime() {
		if (document.visibilityState !== 'visible') return;
		try {
			const ctx = new AudioContext();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = 660;
			gain.gain.setValueAtTime(0, ctx.currentTime);
			gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
			gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
			osc.connect(gain).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + 1.3);
			osc.onended = () => void ctx.close();
		} catch {
			// No audio here; the clock changing is the signal.
		}
	}

	onMount(() => {
		let wasWarming = warming;
		const tick = () => {
			now = Date.now() + skew;
			// Chime only on the crossing seen live, never for a page opened after it.
			if (wasWarming && !warming) chime();
			wasWarming = warming;
		};
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	});

	// Kept per session, so a reload does not lose what was typed.
	const key = $derived(`focus-scratch-${session.startedAt}`);
	let scratch = $state('');
	onMount(() => (scratch = sessionStorage.getItem(key) ?? ''));
	$effect(() => sessionStorage.setItem(key, scratch));

	let busy = $state(false);
	let problem = $state('');
	let ended = $state<{ minutes: number; outcome: Outcome; warnings: string[] } | null>(null);

	async function extend() {
		busy = true;
		const result = await api('/api/focus', { action: 'extend', minutes: 15 });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	async function end(outcome: Outcome) {
		busy = true;
		problem = '';
		const result = await api<{ minutes: number; outcome: Outcome; warnings: string[] }>('/api/focus', { action: 'end', outcome, note: scratch });
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		sessionStorage.removeItem(key);
		if (result.value.warnings.length) ended = result.value;
		else await goto(data.back, { invalidateAll: true });
	}
</script>

<svelte:head><title>{ended ? 'Logged' : `▶ ${clock} · ${name}`} · prosoche</title></svelte:head>

<div class="page narrow">
	{#if ended}
		<section class="card" data-testid="ended">
			<h1>Logged {ended.minutes} min</h1>
			{#each ended.warnings as warning (warning)}<p class="problem" role="status">{warning}</p>{/each}
			<a class="btn primary" href={data.back}>Back</a>
		</section>
	{:else}
		<section class="card" data-testid="session">
			<p class="caps">
				{#if session.kind === 'study'}<i class="dot" style="--dot: {data.color}"></i>{session.name}{#if range}<span class="num"> · {range}</span>{/if}
				{:else}<span class="num">{range}</span>{/if}
			</p>
			{#if warming}<p class="warm" data-testid="warmup-label">{justMinutes(session.warmupMin)}</p>{/if}
			<p class="clock num" class:over={!warming && left < 0} data-testid="clock" aria-live="off">{clock}</p>
			{#if session.kind === 'study'}
				<h1 data-testid="session-step"><StepText text={session.step.text} /></h1>
				{#if session.step.first}<p class="start"><b>Start with:</b> <StepText text={session.step.first} /></p>{/if}
				{#if session.step.est}<p class="est">About {session.step.est}</p>{/if}
			{:else}
				<h1 data-testid="session-step"><StepText text={session.block.text} /></h1>
			{/if}

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
	.warm { margin: var(--s3) 0 0; color: var(--muted); font: 600 var(--t20)/1.2 var(--serif); }
	.clock { margin: var(--s2) 0 var(--s4); font: 600 56px/1 var(--serif); }
	.clock.over { color: var(--warn); }
	h1 { margin: 0 0 var(--s3); font: 600 var(--t20)/1.35 var(--serif); }
	.start { margin: 0 0 var(--s4); line-height: 1.5; }
	.est { margin: 0 0 var(--s4); color: var(--muted); font-size: var(--t13); }
	textarea { width: 100%; margin-bottom: var(--s3); resize: vertical; }
	.row { display: flex; flex-wrap: wrap; gap: var(--s2); }
	.row .btn { min-height: 44px; }
</style>

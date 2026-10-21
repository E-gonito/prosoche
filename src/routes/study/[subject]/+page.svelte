<script lang="ts">
	/**
	 * The one thing to do for this subject now: its next step, the smallest
	 * way to begin it, and a Start button. Which subject is decided in the
	 * daily note, by the block the author wrote there; which step is decided
	 * by the subject's active goal. Nothing here asks for a choice. The goals,
	 * the reading list and the rest are on Plan, one link away.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import StepText from '$lib/components/StepText.svelte';
	import { api } from '$lib/client/api';

	let { data } = $props();

	const base = $derived(`/study/${data.subject.slug}`);
	const step = $derived(data.study.focus?.steps.find((s) => s.state === 'now') ?? null);
	const mine = $derived(data.running?.subject === data.subject.slug);
	const elsewhere = $derived(data.running && !mine ? data.running : null);
	const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

	let busy = $state(false);
	let problem = $state('');

	/** The active goal's open steps whose date has passed, and how far the earliest is behind. */
	const late = $derived.by(() => {
		const open = data.study.focus?.steps.filter((s) => (s.state === 'now' || s.state === 'later') && s.daysLeft !== null && s.daysLeft < 0) ?? [];
		return { count: open.length, by: open.length ? -Math.min(...open.map((s) => s.daysLeft!)) : 0 };
	});

	/** Move the late steps' dates later so the earliest is due today, keeping the gaps between them. */
	async function replan() {
		if (!data.study.focus) return;
		busy = true;
		problem = '';
		const result = await api('/api/study/replan', { subject: data.subject.slug, goal: data.study.focus.name });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	async function start() {
		busy = true;
		problem = '';
		const result = await api('/api/study/session', { action: 'start', subject: data.subject.slug });
		if (result.ok) await goto(`${base}/session`, { invalidateAll: true });
		else {
			problem = result.message;
			busy = false;
		}
	}
</script>

<svelte:head><title>{data.subject.name} · Study · prosoche</title></svelte:head>

<div class="page narrow">
	<nav class="top small">
		<a href="/study">Study</a>
		<a href="{base}/plan" data-testid="plan-link">Plan, goals and reading</a>
	</nav>

	<section class="card" data-testid="session-card">
		<p class="caps"><i class="dot" style="--dot: {data.subject.color}"></i>{data.subject.name} · {data.minutes} min{data.fromBlock ? ' from your block' : ''}</p>

		{#if mine}
			<h1>A session is running</h1>
			<p class="muted">Started on “{data.running?.step.text}”.</p>
			<a class="btn primary go" href="{base}/session" data-testid="continue">Continue</a>
		{:else if elsewhere}
			<h1>Finish {elsewhere.name} first</h1>
			<p class="muted">One session runs at a time.</p>
			<a class="btn primary go" href="/study/{elsewhere.subject}/session">Go to it</a>
		{:else if step}
			<h1 data-testid="step-now"><StepText text={step.task.text} /></h1>
			{#if step.details.first}<p class="start" data-testid="step-start"><b>Start with:</b> <StepText text={step.details.first} /></p>{/if}
			<button class="btn primary go" disabled={busy} onclick={start} data-testid="start">Start</button>
		{:else}
			<h1>Nothing open here</h1>
			<p class="muted">Add a step in <a href="{base}/plan">Plan</a> and it will appear here.</p>
		{/if}
		{#if late.count && !mine}
			<p class="late small muted" data-testid="late">
				{late.count} {late.count === 1 ? 'date has' : 'dates have'} passed, the oldest by {late.by} {late.by === 1 ? 'day' : 'days'}.
				<button type="button" class="link" disabled={busy} onclick={replan} data-testid="replan">Move the dates to today</button>
			</p>
		{/if}
		{#if problem}<p class="problem" role="status">{problem}</p>{/if}
	</section>

	<p class="week muted small" data-testid="week">
		This week: {data.week.sessions} {data.week.sessions === 1 ? 'session' : 'sessions'} · {hours(data.week.minutes)}
	</p>
</div>

<style>
	.narrow { max-width: 640px; }
	.top { display: flex; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s5); }
	.card { padding: var(--s6) var(--s5); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); }
	.caps { display: flex; align-items: center; gap: var(--s2); margin: 0 0 var(--s4); color: var(--muted); font-size: var(--t13); }
	h1 { margin: 0 0 var(--s3); font: 600 var(--t24)/1.3 var(--serif); }
	.start { margin: 0 0 var(--s5); font-size: var(--t16); line-height: 1.5; }
	.go { min-height: 48px; padding: 0 var(--s6); font-size: var(--t16); display: inline-flex; align-items: center; margin-top: var(--s3); }
	.late { margin: var(--s4) 0 0; }
	.link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
	.week { text-align: center; margin-top: var(--s4); }
</style>

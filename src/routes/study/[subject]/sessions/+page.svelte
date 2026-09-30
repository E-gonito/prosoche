<script lang="ts">
	/** A subject's session log: log a sitting against a goal, hours per goal, and the last 8 weeks. */
	import { invalidateAll } from '$app/navigation';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import WeekBars from '$lib/components/WeekBars.svelte';
	import { api } from '$lib/client/api';
	import { formatDuration } from '$lib/shared/duration';

	let { data } = $props();

	let goal = $state('');
	let minutes = $state('');
	let note = $state('');
	let saving = $state(false);
	let problem = $state('');

	async function submit(event: Event) {
		event.preventDefault();
		const mins = Number(minutes);
		if (!mins || mins <= 0 || saving) return;
		saving = true;
		problem = '';
		const result = await api('/api/study/session', { subject: data.subject.slug, day: data.today, minutes: mins, goal: goal || null, note: note.trim() });
		saving = false;
		if (result.ok) {
			goal = '';
			minutes = '';
			note = '';
			await invalidateAll();
		} else {
			problem = result.message;
		}
	}
</script>

<svelte:head><title>Sessions · {data.subject.name} · prosoche</title></svelte:head>

<div class="page">
	<StudyTabs subject={data.subject} lede="The session log: one line per sitting, with the goal it was for." />

	{#if problem}<p class="problem">{problem}</p>{/if}

	<p class="label">Log a session</p>
	<form class="row" onsubmit={submit}>
		<select class="field goal" bind:value={goal} aria-label="Goal" data-testid="session-goal">
			<option value="">No goal</option>
			{#each data.study.goalRefs as g (g.slug)}
				<option value={g.name}>{g.name}</option>
			{/each}
		</select>
		<input class="field minutes" type="number" min="1" step="1" bind:value={minutes} placeholder="Minutes" aria-label="Minutes" data-testid="session-minutes" />
		<input class="field note" bind:value={note} placeholder="What did you work on?" aria-label="Note" data-testid="session-note" />
		<button class="btn primary" disabled={!minutes || Number(minutes) <= 0 || saving} data-testid="log-session">
			{saving ? 'Saving…' : 'Log it'}
		</button>
	</form>
	{#if data.study.goalRefs.length === 0}
		<p class="hint">Sessions roll up by goal. <a href="/study/{data.subject.slug}/goals">Add a goal</a> to log time against it.</p>
	{/if}

	<p class="label">Last 8 weeks</p>
	<div class="sheet">
		<WeekBars weeks={data.study.weeks} />
	</div>

	{#if data.study.goalHours.length > 0}
		<p class="label">This month, by goal</p>
		<div class="sheet rows" data-testid="goal-hours">
			{#each data.study.goalHours as g (`${g.goal}:${g.label}`)}
				<div class="goal-row">
					<span class:muted={!g.goal}>{g.goal ? g.label : g.label === 'Untracked' ? 'No goal' : `[[${g.label}]]`}</span>
					<span class="num muted">{formatDuration(g.minutes, ' ')}</span>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">Sessions</p>
	{#if data.study.sessions.length === 0}
		<p class="none">Nothing logged yet.</p>
	{:else}
		<div class="sheet rows" data-testid="session-log">
			{#each data.study.sessions as s (s.line)}
				<div class="session-row">
					<span class="day muted small num">{s.day}</span>
					<span class="minutes num">{formatDuration(s.minutes, ' ')}</span>
					{#if s.goal}<span class="chip quiet">{s.goal}</span>{:else if s.topic}<span class="chip quiet">[[{s.topic}]]</span>{/if}
					{#if s.note}<span class="note">{s.note}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.row { display: flex; flex-wrap: wrap; gap: var(--s2); margin-bottom: var(--s4); }
	.row .goal { flex: 1; min-width: 140px; }
	.row .minutes { flex: none; width: 100px; }
	.row .note { flex: 2; min-width: 180px; }
	.hint { margin: calc(var(--s2) * -1) 0 var(--s4); }

	.problem { color: var(--bad); margin-bottom: var(--s3); }
	.none { margin: 0 0 var(--s3); }

	.goal-row { display: flex; justify-content: space-between; align-items: center; }

	.session-row { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.session-row .minutes { flex: none; }
	.session-row .note { color: var(--muted); font-size: var(--t13); overflow-wrap: anywhere; }

	@media (max-width: 720px) {
		.row .goal, .row .minutes, .row .note { flex-basis: 100%; width: auto; }
	}
</style>

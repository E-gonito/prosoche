<script lang="ts">
	/** The session log: recent entries, hours per topic, and the last 8 weeks. */
	import { invalidateAll } from '$app/navigation';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import WeekBars from '$lib/components/WeekBars.svelte';
	import { logSession } from '$lib/client/study';
	import { formatDuration } from '$lib/shared/duration';

	let { data } = $props();

	let topic = $state('');
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
		const result = await logSession(data.sessionsPath, { day: data.today, minutes: mins, topic: topic || null, note: note.trim() });
		saving = false;
		if (result.ok) {
			topic = '';
			minutes = '';
			note = '';
			await invalidateAll();
		} else {
			problem = result.message;
		}
	}
</script>

<svelte:head><title>Sessions · Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Study</h1>
		<p>The session log — one line per sitting, with what it was for.</p>
	</div>

	<StudyTabs tabs={data.tabs} />

	{#if problem}<p class="problem">{problem}</p>{/if}

	<p class="label">Log a session</p>
	<form class="row" onsubmit={submit}>
		<select class="field topic" bind:value={topic} aria-label="Topic" data-testid="session-topic">
			<option value="">No topic</option>
			{#each data.topics as name (name)}
				<option value={name}>{name}</option>
			{/each}
		</select>
		<input class="field minutes" type="number" min="1" step="1" bind:value={minutes} placeholder="Minutes" aria-label="Minutes" data-testid="session-minutes" />
		<input class="field note" bind:value={note} placeholder="What did you work on?" aria-label="Note" data-testid="session-note" />
		<button class="btn primary" disabled={!minutes || Number(minutes) <= 0 || saving} data-testid="log-session">
			{saving ? 'Saving…' : 'Log it'}
		</button>
	</form>

	<p class="label">Last 8 weeks</p>
	<div class="sheet">
		<WeekBars weeks={data.weeks} />
	</div>

	{#if data.topicHours.length > 0}
		<p class="label">This month, by topic</p>
		<div class="sheet rows" data-testid="topic-hours">
			{#each data.topicHours as t (t.topic)}
				<div class="topic-row">
					<span>{t.topic}</span>
					<span class="num muted">{formatDuration(t.minutes, ' ')}</span>
				</div>
			{/each}
		</div>
	{/if}

	<p class="label">Sessions</p>
	{#if data.sessions.length === 0}
		<p class="none">Nothing logged yet.</p>
	{:else}
		<div class="sheet rows" data-testid="session-log">
			{#each data.sessions as s (s.line)}
				<div class="session-row">
					<span class="day muted small num">{s.day}</span>
					<span class="minutes num">{formatDuration(s.minutes, ' ')}</span>
					{#if s.topic}<span class="chip quiet">{s.topic}</span>{/if}
					{#if s.note}<span class="note">{s.note}</span>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.row { display: flex; flex-wrap: wrap; gap: var(--s2); margin-bottom: var(--s4); }
	.row .topic { flex: 1; min-width: 140px; }
	.row .minutes { flex: none; width: 100px; }
	.row .note { flex: 2; min-width: 180px; }

	.problem { color: var(--bad); margin-bottom: var(--s3); }
	.none { margin: 0 0 var(--s3); }

	.topic-row { display: flex; justify-content: space-between; align-items: center; }

	.session-row { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.session-row .minutes { flex: none; }
	.session-row .note { color: var(--muted); font-size: var(--t13); overflow-wrap: anywhere; }

	@media (max-width: 720px) {
		.row .topic, .row .minutes, .row .note { flex-basis: 100%; width: auto; }
	}
</style>

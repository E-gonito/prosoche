<script lang="ts">
	/**
	 * A dating person: their profile, their notes read-only, the dates log,
	 * and two small writes — a new date, appended, and a stage change, which
	 * rewrites only the frontmatter `stage:` line.
	 */
	import { api } from '$lib/client/api';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	// Resynced below whenever `data` changes; seeded here so the select has a
	// value before that effect first runs.
	// svelte-ignore state_referenced_locally
	let stage = $state<string>(data.stage ?? data.stages[0]);
	let stageSaving = $state(false);
	let stageProblem = $state('');

	$effect(() => {
		stage = data.stage ?? data.stages[0];
	});

	async function changeStage(next: string) {
		stageSaving = true;
		stageProblem = '';
		const result = await api('/api/dating/people/stage', { name: data.name, stage: next });
		stageSaving = false;
		if (!result.ok) {
			stageProblem = result.message;
			return;
		}
		stage = next;
		await invalidateAll();
	}

	let day = $state(new Date().toISOString().slice(0, 10));
	let text = $state('');
	let rating = $state('');
	let cost = $state('');
	let notes = $state('');
	let addingDate = $state(false);
	let dateProblem = $state('');

	async function addDate() {
		if (addingDate || !text.trim()) return;
		addingDate = true;
		dateProblem = '';
		const result = await api('/api/dating/people/date', {
			name: data.name,
			day,
			text,
			rating: rating ? Number(rating) : null,
			cost: cost ? Number(cost) : null,
			notes
		});
		addingDate = false;
		if (!result.ok) {
			dateProblem = result.message;
			return;
		}
		text = notes = '';
		rating = cost = '';
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.name} · Date · prosoche</title></svelte:head>

<div class="title-row">
	<h2>{data.name}</h2>
	<label class="stage-pick">
		Stage
		<select
			class="field"
			value={stage}
			disabled={stageSaving}
			onchange={(e) => changeStage((e.currentTarget as HTMLSelectElement).value)}
			data-testid="dating-stage-select"
		>
			{#each data.stages as s (s)}<option value={s}>{s}</option>{/each}
		</select>
	</label>
</div>
{#if stageProblem}<p class="problem">{stageProblem}</p>{/if}

<div class="kv profile" data-testid="dating-profile">
	<b>App</b><span>{data.app ?? '—'}</span>
	<b>Age</b><span>{data.age ?? '—'}</span>
	<b>Place</b><span>{data.place ?? '—'}</span>
	<b>Job</b><span>{data.job ?? '—'}</span>
</div>

{#if data.html}
	<p class="label">Notes</p>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="sheet prose" data-testid="dating-person-notes">{@html data.html}</div>
{/if}

<p class="label">Dates <span class="right muted">{data.dates.length}</span></p>
<div class="sheet rows" data-testid="dating-dates-log">
	{#each data.dates as d (d.line)}
		<div class="date-row">
			<span class="date">{d.day}</span>
			<span>{d.text}</span>
			{#if d.rating !== null}<span class="tag">rating {d.rating}</span>{/if}
			{#if d.cost !== null}<span class="tag">cost {d.cost}</span>{/if}
			{#if d.notes}<span class="muted small">{d.notes}</span>{/if}
		</div>
	{:else}
		<p class="empty">No dates logged yet.</p>
	{/each}
</div>

<p class="label">Add a date</p>
<form class="sheet add-date" onsubmit={(e) => { e.preventDefault(); void addDate(); }}>
	<input class="field" type="date" bind:value={day} aria-label="Date" data-testid="dating-date-day" />
	<input class="field" placeholder="What / where" bind:value={text} aria-label="What and where" data-testid="dating-date-text" required />
	<input class="field" placeholder="Rating (1-5)" bind:value={rating} aria-label="Rating" inputmode="numeric" />
	<input class="field" placeholder="Cost" bind:value={cost} aria-label="Cost" inputmode="numeric" />
	<input class="field notes-field" placeholder="Notes (optional)" bind:value={notes} aria-label="Notes" />
	<button class="btn primary" type="submit" disabled={addingDate} data-testid="dating-date-submit">
		{addingDate ? 'Adding…' : 'Add a date'}
	</button>
</form>
{#if dateProblem}<p class="problem">{dateProblem}</p>{/if}

<style>
	.title-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); margin-bottom: var(--s3); flex-wrap: wrap; }
	.title-row h2 { font-family: var(--serif); font-size: var(--t24); margin: 0; }
	.stage-pick { display: flex; align-items: center; gap: var(--s2); font-size: var(--t13); color: var(--muted); }
	.stage-pick select { width: auto; }

	.profile { margin-bottom: var(--s5); }
	.date-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s2); }
	.date-row .date { font-weight: 600; min-width: 90px; }

	.add-date { display: grid; grid-template-columns: 1fr 2fr 1fr 1fr; gap: var(--s3); }
	.add-date .notes-field { grid-column: 1 / -1; }
	.add-date button { grid-column: 1 / -1; }
	@media (max-width: 720px) {
		.add-date { grid-template-columns: 1fr; }
	}
</style>

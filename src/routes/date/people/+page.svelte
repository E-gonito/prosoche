<script lang="ts">
	/** People: dating profiles grouped by stage, and the form that adds one. */
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let name = $state('');
	let app = $state('');
	let age = $state('');
	let place = $state('');
	let job = $state('');
	// Seeded once as the form's default, not tracked: reloading the people
	// list after adding someone must not reset what is mid-typed.
	// svelte-ignore state_referenced_locally
	let stage = $state<string>(data.stages[0]);
	let adding = $state(false);
	let problem = $state('');

	const groups = $derived(
		data.stages.map((s: string) => ({ stage: s, people: data.people.filter((p: { stage: string | null }) => p.stage === s) }))
	);
	const unstaged = $derived(data.people.filter((p: { stage: string | null }) => !p.stage));

	async function addPerson() {
		if (adding || !name.trim()) return;
		adding = true;
		problem = '';
		try {
			const res = await fetch('/api/dating/people', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, app, age, place, job, stage })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				problem = body.error ?? `Could not add ${name} (${res.status})`;
				return;
			}
			name = app = age = place = job = '';
			await invalidateAll();
		} catch {
			problem = 'No connection.';
		} finally {
			adding = false;
		}
	}
</script>

<svelte:head><title>People · Date · prosoche</title></svelte:head>

{#each groups as g (g.stage)}
	{#if g.people.length}
		<p class="label">{g.stage} <span class="right muted">{g.people.length}</span></p>
		<div class="sheet rows" data-testid="dating-people-group">
			{#each g.people as p (p.path)}
				<a class="person-row" href="/date/people/{encodeURIComponent(p.name)}">
					<b>{p.name}</b>
					<span class="muted small">{[p.app, p.place, p.job].filter(Boolean).join(' · ') || '—'}</span>
				</a>
			{/each}
		</div>
	{/if}
{/each}
{#if unstaged.length}
	<p class="label">No stage set <span class="right muted">{unstaged.length}</span></p>
	<div class="sheet rows">
		{#each unstaged as p (p.path)}
			<a class="person-row" href="/date/people/{encodeURIComponent(p.name)}"><b>{p.name}</b></a>
		{/each}
	</div>
{/if}
{#if data.people.length === 0}
	<p class="none">Nobody logged yet.</p>
{/if}

<p class="label">Add person</p>
<form class="sheet add-form" onsubmit={(e) => { e.preventDefault(); void addPerson(); }}>
	<input class="field" placeholder="Name" bind:value={name} aria-label="Name" data-testid="dating-add-name" required />
	<input class="field" placeholder="App (Hinge, Bumble…)" bind:value={app} aria-label="App" />
	<input class="field" placeholder="Age" bind:value={age} aria-label="Age" />
	<input class="field" placeholder="Place" bind:value={place} aria-label="Place" />
	<input class="field" placeholder="Job" bind:value={job} aria-label="Job" />
	<select class="field" bind:value={stage} aria-label="Stage">
		{#each data.stages as s (s)}<option value={s}>{s}</option>{/each}
	</select>
	<button class="btn primary" type="submit" disabled={adding} data-testid="dating-add-submit">
		{adding ? 'Adding…' : 'Add person'}
	</button>
</form>
{#if problem}<p class="problem">{problem}</p>{/if}

<style>
	.person-row { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
	.person-row:hover { text-decoration: none; }
	.person-row:hover b { color: var(--accent); }
	.add-form { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s3); }
	.add-form button { grid-column: 1 / -1; }
	@media (max-width: 720px) {
		.add-form { grid-template-columns: 1fr; }
	}
</style>

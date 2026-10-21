<script lang="ts">
	/**
	 * One scenario, answer and Why shown. It plays in missions as it is,
	 * generated or not; there is nothing to approve. Retire takes a wrong one
	 * out of every mission without deleting it, and Bring back undoes that.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import Draft from '$lib/components/Draft.svelte';
	import { noteHref } from '$lib/shared/links';
	import TacticMap from '$lib/components/tactics/TacticMap.svelte';
	import type { Status } from '$lib/shared/tactics';

	let { data } = $props();

	let busy = $state(false);
	let problem = $state('');

	const s = $derived(data.scenario);

	async function setStatus(status: Status) {
		if (!s || busy) return;
		busy = true;
		problem = '';
		const result = await api('/api/tactics/status', { id: s.id, status });
		busy = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	const answerText = (answer: string[]) =>
		s?.drill === 'clear-order' ? answer.join(' → ') : `${answer[0]}: ${s?.options.find((o) => o.key === answer[0])?.text ?? ''}`;
</script>

<svelte:head><title>{s?.id ?? data.problem?.id ?? 'Scenario'} · Tactics · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<a class="crumb" href="/tactics">Tactics</a>
		<h1>{s?.id ?? data.problem?.id}</h1>
		{#if s}
			<p>{s.game} · {s.drill} · difficulty {s.difficulty} · {s.timeLimitS}s</p>
		{/if}
	</div>

	{#if data.problem}
		<div class="sheet" data-testid="scenario-problem">
			<p>This note does not read as a scenario:</p>
			<ul class="errors">{#each data.problem.errors as e, i (i)}<li>{e}</li>{/each}</ul>
			<a href={noteHref(data.problem.path)}>Open the note</a>
		</div>
	{:else if s}
		<div class="status-row" data-testid="scenario-status">
			{#if s.status === 'retired'}<span class="badge muted">retired</span>{/if}
			<span class="badge muted">{s.provenance}</span>
			<span class="muted small">{s.verifiedVersion ? `Checked on ${s.verifiedVersion}` : 'Not checked in game'}</span>
			<span class="spacer"></span>
			{#if s.status === 'retired'}
				<button class="btn small" disabled={busy} onclick={() => setStatus('draft')} data-testid="unretire">Bring back</button>
			{:else}
				<button class="btn small ghost" disabled={busy} onclick={() => setStatus('retired')} title="Take it out of every mission; the note stays." data-testid="retire">Retire</button>
			{/if}
		</div>
		{#if s.status === 'draft'}
			<div class="suggest">
				<Draft
					label="Suggest improvements"
					title="Claude proposes a sharper situation, more options, tags and a map. Your answer and Why are never touched."
					endpoint="/api/tactics/suggest"
					request={{ id: s.id }}
					ondone={() => invalidateAll()}
				/>
			</div>
		{/if}
		{#if problem}<p class="problem" role="status">{problem}</p>{/if}

		<p class="label">Situation</p>
		<div class="prose">{@html s.situationHtml}</div>

		{#if s.map}
			<p class="label">Map</p>
			<TacticMap map={s.map} picked={s.drill === 'clear-order' ? s.answers[0] : []} />
		{/if}

		{#if s.options.length}
			<p class="label">Options</p>
			<ul class="options">
				{#each s.options as o (o.key)}
					<li class:right={s.answers.some((a) => a[0] === o.key)} class:roe={s.roeViolation.includes(o.key)}>
						<b>{o.key}</b>
						{o.text}
						{#if s.answers.some((a) => a[0] === o.key)}<span class="badge ok">answer</span>{/if}
						{#if s.roeViolation.includes(o.key)}<span class="badge warn">ROE violation</span>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="label">Answer</p>
			<ul class="options">{#each s.answers as a, i (i)}<li class="right">{answerText(a)}</li>{/each}</ul>
		{/if}

		<p class="label">Why</p>
		{#if s.whyHtml}<div class="prose">{@html s.whyHtml}</div>{:else}<p class="muted">Not written yet.</p>{/if}

		<p class="label">Source</p>
		<p class="small">{s.source || 'None given.'}</p>
		<p class="small"><a href={noteHref(s.path)}>Open the note</a> to edit it; Obsidian is the editor.</p>
	{/if}
</div>

<style>
	.suggest { margin-top: var(--s2); }
	.status-row { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
	.spacer { flex: 1; }
	.options { list-style: none; padding: 0; display: grid; gap: 6px; }
	.options li { padding: var(--s2) var(--s3); border: 1px solid var(--line); border-radius: var(--r); background: var(--panel); }
	.options li.right { border-color: var(--ok); }
	.options li.roe { border-color: var(--bad); }
	.options b { color: var(--accent); margin-right: var(--s2); }
	.errors { color: var(--bad); }
</style>

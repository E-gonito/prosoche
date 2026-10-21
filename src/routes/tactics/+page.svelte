<script lang="ts">
	/**
	 * Tactics: choose a mission, see which tags are weakest, and browse the
	 * scenarios in `Tactics/Scenarios/`, drafts and problems included.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import Draft from '$lib/components/Draft.svelte';
	import { noteHref } from '$lib/shared/links';
	import { TACTICS, type Mode } from '$lib/shared/tactics';

	let { data } = $props();

	const MODE_LABEL: Record<Mode, string> = { ron: 'Ready or Not', bodycam: 'Bodycam', shared: 'Shared CQB', 'aar-review': 'My AARs' };
	const MODE_HINT: Record<Mode, string> = {
		ron: 'Ready or Not scenarios and the shared CQB core.',
		bodycam: 'Bodycam scenarios and the shared CQB core.',
		shared: 'Only the CQB core both games share.',
		'aar-review': 'Only scenarios from your own after-action reviews.'
	};

	let mode = $state<Mode>('bodycam');
	let length = $state(TACTICS.length.default);
	// svelte-ignore state_referenced_locally
	let drafts = $state(data.pools.bodycam.approved === 0);
	let adding = $state(false);
	let problem = $state('');

	const pool = $derived(drafts ? data.pools[mode].withDrafts : data.pools[mode].approved);
	const hasDrafts = $derived(data.scenarios.some((s) => s.status === 'draft'));
	const start = $derived(`/tactics/mission?mode=${mode}&n=${length}${drafts ? '&drafts=1' : ''}`);
	const weakest = $derived(data.tags.slice(0, 6));

	async function addStarters() {
		adding = true;
		problem = '';
		const result = await api<{ written: string[] }>('/api/tactics/starters', {});
		adding = false;
		if (result.ok) await invalidateAll();
		else problem = result.message;
	}

	const pct = (n: number) => `${Math.round(n * 100)}%`;
</script>

<svelte:head><title>Tactics · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Tactics</h1>
		<p>Timed decisions for Ready or Not and Bodycam, from the scenarios in <code>Tactics/</code>.</p>
	</div>

	{#if !data.hasFolder}
		<div class="empty big" data-testid="tactics-empty">
			<h2>No scenarios yet</h2>
			<p class="muted">
				Starter drafts are eight shared CQB scenarios, built on the deaths you listed. They are written by prosoche,
				not by you, so each one is <code>provenance: inferred</code> and <code>status: draft</code>, and its Why is
				marked as a suggestion. They also come with a list of Ready or Not rules-of-engagement claims to check in game.
			</p>
			<button class="btn primary" onclick={addStarters} disabled={adding} data-testid="add-starters">{adding ? 'Adding…' : 'Add the starter drafts'}</button>
			{#if problem}<p class="problem" role="status">{problem}</p>{/if}
		</div>
	{:else}
		<section class="sheet start" data-testid="mission-select">
			<p class="label">Mission</p>
			<div class="chips" role="radiogroup" aria-label="Mode">
				{#each Object.keys(MODE_LABEL) as m (m)}
					{@const key = m as Mode}
					<button type="button" class="chip" class:on={mode === key} role="radio" aria-checked={mode === key} onclick={() => (mode = key)} data-testid="mode-{key}">
						{MODE_LABEL[key]}<span class="n num">{drafts ? data.pools[key].withDrafts : data.pools[key].approved}</span>
					</button>
				{/each}
			</div>
			<p class="hint">{MODE_HINT[mode]}</p>

			<div class="row">
				<label>
					Drills
					<select class="field" bind:value={length} data-testid="mission-length">
						{#each [8, 10, 12] as n (n)}<option value={n}>{n}</option>{/each}
					</select>
				</label>
				{#if hasDrafts}
					<label class="check">
						<input type="checkbox" bind:checked={drafts} data-testid="include-drafts" />
						Include drafts
					</label>
				{/if}
				{#if pool > 0}
					<a class="btn primary go" href={start} data-testid="start-mission">Start {Math.min(pool, length)} drills</a>
				{:else}
					<span class="muted small go">{drafts || !hasDrafts ? 'No scenarios for this mode yet.' : 'Nothing approved here yet. Include drafts, or approve some.'}</span>
				{/if}
			</div>
			{#if drafts}
				<p class="hint warn-text">Drafts have not been checked by you, so treat their answers as guesses to test, not as fact.</p>
			{/if}
			<p class="hint">Keys: <b>1</b>–<b>9</b> or <b>A</b>–<b>I</b> pick an option, and <b>1</b>–<b>9</b> pick an angle in order; <b>Backspace</b> undoes the last angle; <b>Space</b> moves on.</p>
		</section>

		<section class="sheet more" data-testid="make-scenarios">
			<p class="label">Make more scenarios</p>
			<div class="row">
				<a class="btn" href="/tactics/aar" data-testid="aar-link">Write an after-action review</a>
				<Draft
					label="Generate with Claude"
					title="Claude drafts new scenarios as inferred drafts for the selected game. Nothing is written until you accept, and you approve each one yourself."
					endpoint="/api/tactics/generate"
					request={{ game: mode === 'aar-review' ? 'shared' : mode, tags: weakest.slice(0, 3).map((t) => t.tag), count: 3 }}
					ondone={() => invalidateAll()}
				/>
			</div>
			<p class="hint">Generated drafts are guesses from Claude, not facts. They stay drafts until you rewrite the Why and approve.</p>
		</section>

		<p class="label">Weakest tags</p>
		{#if data.attempts === 0}
			<p class="hint">Play a mission and your weakest tags show here. Every tag starts at {pct(TACTICS.prior)}.</p>
		{:else}
			<ul class="tags rows" data-testid="weakest-tags">
				{#each weakest as t (t.tag)}
					<li>
						<code>{t.tag}</code>
						<span class="bar" aria-hidden="true"><i style="width: {pct(t.accuracy)}"></i></span>
						<span class="num">{pct(t.accuracy)}</span>
						<span class="muted small num">{t.answers} {t.answers === 1 ? 'answer' : 'answers'}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<p class="label">
			Scenarios
			<a class="right small" href={noteHref('Tactics/To verify in game.md')}>To verify in game</a>
		</p>
		<ul class="sheet rows library" data-testid="scenario-list">
			{#each data.scenarios as s (s.id)}
				<li>
					<a href="/tactics/scenario/{s.id}"><code>{s.id}</code></a>
					<span class="small">{s.drill}</span>
					<span class="muted small tags-inline">{s.tags.join(' ')}</span>
					<span class="badge {s.status === 'approved' ? 'ok' : s.status === 'draft' ? 'warn' : 'muted'}">{s.status}</span>
					<span class="badge muted">{s.provenance}</span>
				</li>
			{/each}
		</ul>
		{#if hasDrafts}
			<p class="hint">
				A draft becomes part of a normal mission once you approve it, and you can only approve it once its Why is in
				your own words.
			</p>
			<button class="btn small" onclick={addStarters} disabled={adding}>Add any missing starter drafts</button>
		{/if}

		{#if data.problems.length}
			<p class="label">Do not read</p>
			<ul class="sheet rows" data-testid="scenario-problems">
				{#each data.problems as p (p.path)}
					<li>
						<a href={noteHref(p.path)}><code>{p.path}</code></a>
						<ul class="errors">
							{#each p.errors as e, i (i)}<li class="small">{e}</li>{/each}
						</ul>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

<style>
	.start, .more { margin-bottom: var(--s5); }
	.more .label { margin-top: 0; }
	.start .label { margin-top: 0; }
	.chip .n { color: var(--muted); font-size: var(--t12); }
	.row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s4); margin-top: var(--s3); }
	.row label { display: flex; align-items: center; gap: var(--s2); font-size: var(--t14); }
	.go { margin-left: auto; }
	.warn-text { color: var(--warn); }
	.tags { list-style: none; padding: 0; margin: 0 0 var(--s5); }
	.tags li { display: grid; grid-template-columns: 160px 1fr 48px 90px; align-items: center; gap: var(--s3); }
	.bar { height: 6px; border-radius: 3px; background: var(--soft); overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--accent); }
	.library { list-style: none; margin: 0 0 var(--s3); }
	.library li { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.tags-inline { flex: 1; min-width: 0; }
	.errors { margin: var(--s1) 0 0; padding-left: var(--s4); color: var(--bad); }
	@media (max-width: 720px) {
		.tags li { grid-template-columns: 1fr 48px; }
		.tags .bar, .tags li > .muted { display: none; }
		.go { margin-left: 0; }
	}
</style>

<script lang="ts">
	/**
	 * After-action review: what happened, what you did, what you should have
	 * done. Saving writes the review and a draft scenario made from it, in
	 * your words, which you read and approve like any other.
	 */
	import { goto } from '$app/navigation';
	import { api } from '$lib/client/api';
	import type { Game } from '$lib/shared/tactics';

	const GAMES: Array<[Game, string]> = [
		['bodycam', 'Bodycam'],
		['ron', 'Ready or Not'],
		['shared', 'Both']
	];

	let game = $state<Game>('bodycam');
	let map = $state('');
	let happened = $state('');
	let did = $state('');
	let should = $state('');
	let tags = $state('');
	let busy = $state(false);
	let problem = $state('');

	async function save(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		problem = '';
		const result = await api<{ id: string }>('/api/tactics/aar', {
			game,
			map,
			happened,
			did,
			should,
			tags: tags.split(/[\s,]+/).filter(Boolean)
		});
		busy = false;
		if (result.ok) await goto(`/tactics/scenario/${result.value.id}`);
		else problem = result.message;
	}
</script>

<svelte:head><title>After-action review · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>After-action review</h1>
		<p>Write down the moment that went wrong. It becomes a draft drill with your correction as the answer.</p>
	</div>

	<form class="sheet form" onsubmit={save} data-testid="aar-form">
		<div class="chips" role="radiogroup" aria-label="Game">
			{#each GAMES as [g, label] (g)}
				<button type="button" class="chip" class:on={game === g} role="radio" aria-checked={game === g} onclick={() => (game = g)}>{label}</button>
			{/each}
		</div>
		<label>Map / mission<input class="field" bind:value={map} placeholder="Map, and mode or mission" data-testid="aar-map" /></label>
		<label>What happened<textarea class="field" rows="3" bind:value={happened} placeholder="Where you were and what you knew" data-testid="aar-happened"></textarea></label>
		<label>What I did<textarea class="field" rows="2" bind:value={did} data-testid="aar-did"></textarea></label>
		<label>What I should have done<textarea class="field" rows="2" bind:value={should} data-testid="aar-should"></textarea></label>
		<label>Tags<input class="field" bind:value={tags} placeholder="cqb.corner, bodycam.peek" data-testid="aar-tags" /></label>
		{#if problem}<p class="problem" role="status" data-testid="aar-problem">{problem}</p>{/if}
		<div class="actions">
			<button class="btn primary" disabled={busy} data-testid="aar-save">{busy ? 'Saving…' : 'Save review'}</button>
			<a class="btn" href="/tactics">Cancel</a>
		</div>
	</form>
</div>

<style>
	.form { display: flex; flex-direction: column; gap: var(--s3); }
	.form label { display: flex; flex-direction: column; gap: var(--s1); font-size: var(--t14); }
	.actions { display: flex; gap: var(--s2); }
</style>

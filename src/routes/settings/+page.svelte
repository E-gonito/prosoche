<script lang="ts">
	/**
	 * AI settings: model, effort, budget and timeout for every feature, the
	 * limits they all sit under, and the record of what has happened.
	 *
	 * The page is a form over `_hub/ai.md`, which is the user's own markdown
	 * file. That is why the path is printed at the top: anything here can be
	 * edited in Obsidian instead, and neither copy is the real one.
	 *
	 * There is no permission column. Every run is read-only, and a mode that
	 * could be changed here would be a guardrail someone could switch off.
	 */
	import {
		EFFORTS,
		FEATURE_LABELS,
		GUARDRAILS,
		type AiSettings,
		type FeatureId
	} from '$lib/shared/ai';
	import { api } from '$lib/client/api';

	let { data } = $props();

	// Edited in place and saved explicitly, so it is seeded once rather than
	// tracked: a reload mid-edit must not discard what is on screen.
	// svelte-ignore state_referenced_locally
	let settings = $state<AiSettings>(structuredClone(data.settings));
	let saved = $state('');
	let problem = $state('');
	let busy = $state(false);

	const features = $derived(Object.keys(settings.features) as FeatureId[]);

	async function save() {
		busy = true;
		saved = '';
		problem = '';
		const result = await api<{ settings: AiSettings }>('/api/ai/settings', settings);
		busy = false;
		if (result.ok) {
			settings = result.value.settings;
			saved = `Saved to ${data.settingsPath}.`;
		} else {
			problem = result.message;
		}
	}

	async function revert(id: string) {
		busy = true;
		const result = await api<{ undone: { restored: string[]; skipped: string[] } }>('/api/ai/proposal', { action: 'undo', undoId: id });
		busy = false;
		saved = result.ok
			? `Put back ${result.value.undone.restored.length} file${result.value.undone.restored.length === 1 ? '' : 's'}.`
			: '';
		problem = result.ok ? '' : result.message;
	}
</script>

<svelte:head><title>Settings · prosoche</title></svelte:head>

<div class="page">

<div class="title">
	<h1>Settings</h1>
	<p><span class="path">{data.settingsPath}</span></p>
</div>

<section class="card">
	<h3>Kill switch</h3>
	<label class="switch">
		<input type="checkbox" bind:checked={settings.enabled} data-testid="ai-enabled" />
		<span>
			AI is <b>{settings.enabled ? 'on' : 'off'}</b>.
			{#if settings.enabled}
				Turning it off stops every surface and every scheduled job at once.
			{:else}
				Every AI surface and scheduled job is disabled.
			{/if}
		</span>
	</label>
</section>

<section class="card">
	<h3>Per feature</h3>
	<table data-testid="feature-table">
		<thead>
			<tr><th>Feature</th><th>Model</th><th>Effort</th><th>Budget</th><th>Timeout</th></tr>
		</thead>
		<tbody>
			{#each features as feature (feature)}
				<tr data-feature={feature}>
					<th scope="row">{FEATURE_LABELS[feature]}</th>
					<td>
						<select bind:value={settings.features[feature].model} aria-label="{FEATURE_LABELS[feature]} model" data-testid="model-{feature}">
							{#each data.models as m (m.id)}<option value={m.id} title={m.hint}>{m.label}</option>{/each}
						</select>
					</td>
					<td>
						<select bind:value={settings.features[feature].effort} aria-label="{FEATURE_LABELS[feature]} effort" data-testid="effort-{feature}">
							{#each EFFORTS as e (e)}<option value={e}>{e}</option>{/each}
						</select>
					</td>
					<td><input type="number" min="0.01" max="2" step="0.05" bind:value={settings.features[feature].budgetUsd} aria-label="{FEATURE_LABELS[feature]} budget" /></td>
					<td><input type="number" min="5" max="900" step="5" bind:value={settings.features[feature].timeoutSeconds} aria-label="{FEATURE_LABELS[feature]} timeout" /></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="hint">Every run is read-only. There is no mode that writes without you.</p>
</section>

<section class="card">
	<h3>Limits</h3>
	<div class="kv">
		<b>Daily budget</b>
		<span><input type="number" min="0" max="100" step="0.5" bind:value={settings.budget.dailyUsd} data-testid="daily-budget" aria-label="Daily budget" /> US dollars</span>
		<b>Files per proposal</b>
		<span><input type="number" min="1" max="20" bind:value={settings.blast.maxFiles} data-testid="max-files" aria-label="Files per proposal" /></span>
		<b>Lines a file may lose</b>
		<span><input type="number" min="0" max="1" step="0.05" bind:value={settings.blast.maxLineLoss} aria-label="Line loss limit" /> as a fraction</span>
	</div>
</section>

<div class="actions">
	<button class="btn primary" disabled={busy} onclick={save} data-testid="save-ai-settings">Save</button>
	{#if saved}<span class="ok" data-testid="settings-saved">{saved}</span>{/if}
	{#if problem}<span class="bad">{problem}</span>{/if}
</div>

<section class="card">
	<h3>Today <span class="right muted">{data.day}</span></h3>
	<p class="spend" data-testid="ai-spend">
		${data.spend.usd.toFixed(4)} spent over {data.spend.runs} run{data.spend.runs === 1 ? '' : 's'}, against a
		${settings.budget.dailyUsd.toFixed(2)} cap. The CLI is <code>{data.executable}</code>.
	</p>
	{#if data.runs.length}
		<pre class="log" data-testid="ai-log">{data.runs.join('\n')}</pre>
	{:else}
		<p class="muted">Nothing has run today.</p>
	{/if}
</section>

<section class="card">
	<h3>Undo</h3>
	{#if data.snapshots.length}
		<ul class="snaps" data-testid="undo-list">
			{#each data.snapshots as snap (snap.id)}
				<li>
					<span class="when">{snap.at.slice(0, 16).replace('T', ' ')}</span>
					<span class="files">{snap.paths.join(', ')}</span>
					<button class="btn" disabled={busy} onclick={() => revert(snap.id)} data-testid="undo-{snap.id}">Put back</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No snapshots. One is taken before anything is applied, and kept for seven days.</p>
	{/if}
</section>

<section class="card">
	<h3>The nine guardrails</h3>
	<ol class="rails">
		{#each Object.entries(GUARDRAILS) as [id, title] (id)}
			<li><span class="tag">{id}</span> {title}</li>
		{/each}
	</ol>
	<p class="hint">These are code paths, not instructions in a prompt.</p>
</section>
</div>

<style>
	/* A path, so monospaced. */
	.path { font: var(--t12) var(--mono); }
	section { margin-bottom: 14px; }
	.switch { display: flex; align-items: flex-start; gap: 10px; font-size: var(--t14); }
	table { border-collapse: collapse; width: 100%; font-size: var(--t13); }
	th, td { text-align: left; padding: 5px var(--s2); border-bottom: 1px solid var(--line); }
	thead th { font-size: var(--t11); text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	tbody th { font-weight: 500; }
	select, input {
		font: inherit;
		font-size: var(--t13);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 3px 6px;
		background: var(--field);
		color: inherit;
	}
	input[type='number'] { width: 76px; }
	.actions { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
	.ok { color: var(--ok); font-size: var(--t13); }
	.bad { color: var(--bad); font-size: var(--t13); }
	.spend { margin: 0 0 var(--s2); font-size: var(--t13); }
	.log { max-height: 300px; overflow: auto; font: var(--t11)/1.6 var(--mono); white-space: pre; margin: 0; }
	.snaps { list-style: none; margin: 0; padding: 0; font-size: var(--t13); }
	.snaps li { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); }
	/* A date, so body text with the figures lined up rather than monospace. */
	.when { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); }
	.files { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rails { margin: 0; padding-left: 0; list-style: none; display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s1) var(--s4); font-size: var(--t13); }
	/* A guardrail's name, drawn as the shared `.tag` but stated firmly. */
	.rails .tag { font-weight: 700; }
	code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
</style>

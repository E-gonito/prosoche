<script lang="ts">
	/**
	 * AI settings: model, effort and permission for every feature, the limits
	 * they all sit under, and the record of what has happened.
	 *
	 * The page is a form over `_hub/ai.md`, which is the user's own markdown
	 * file. That is why the path is printed at the top: anything here can be
	 * edited in Obsidian instead, and neither copy is the real one.
	 *
	 * The permission column has three options and will never have a fourth.
	 * A "skip all checks" mode is the one setting that would make every other
	 * guardrail decorative, so it does not exist in the type, in this select,
	 * or in the flags the CLI is given.
	 */
	import {
		EFFORTS,
		FEATURE_LABELS,
		GUARDRAILS,
		MODELS,
		PERMISSION_MODES,
		type AiSettings,
		type FeatureId
	} from '$lib/shared/ai';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { saveAiSettings, undoProposal } from '$lib/client/ai';

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
		const result = await saveAiSettings(settings);
		busy = false;
		if (result.ok) {
			settings = result.value;
			saved = `Saved to ${data.settingsPath}.`;
		} else {
			problem = result.message;
		}
	}

	async function revert(id: string) {
		busy = true;
		const result = await undoProposal(id);
		busy = false;
		saved = result.ok
			? `Put back ${result.value.restored.length} file${result.value.restored.length === 1 ? '' : 's'}.`
			: '';
		problem = result.ok ? '' : result.message;
	}
</script>

<svelte:head><title>AI settings · prosoche</title></svelte:head>

<PageHeader title="AI settings">
	{#snippet meta()}
		<span class="path">{data.settingsPath}</span>
	{/snippet}
</PageHeader>

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
			<tr><th>Feature</th><th>Model</th><th>Effort</th><th>Permission</th><th>Budget</th><th>Timeout</th></tr>
		</thead>
		<tbody>
			{#each features as feature (feature)}
				<tr data-feature={feature}>
					<th scope="row">{FEATURE_LABELS[feature]}</th>
					<td>
						<select bind:value={settings.features[feature].model} aria-label="{FEATURE_LABELS[feature]} model" data-testid="model-{feature}">
							{#each MODELS as m (m.id)}<option value={m.id} title={m.hint}>{m.label}</option>{/each}
						</select>
					</td>
					<td>
						<select bind:value={settings.features[feature].effort} aria-label="{FEATURE_LABELS[feature]} effort" data-testid="effort-{feature}">
							{#each EFFORTS as e (e)}<option value={e}>{e}</option>{/each}
						</select>
					</td>
					<td>
						<select
							bind:value={settings.features[feature].permission}
							aria-label="{FEATURE_LABELS[feature]} permission"
							data-testid="permission-{feature}"
						>
							{#each PERMISSION_MODES as m (m.id)}<option value={m.id} title={m.hint}>{m.label}</option>{/each}
						</select>
					</td>
					<td><input type="number" min="0.01" max="2" step="0.05" bind:value={settings.features[feature].budgetUsd} aria-label="{FEATURE_LABELS[feature]} budget" /></td>
					<td><input type="number" min="5" max="900" step="5" bind:value={settings.features[feature].timeoutSeconds} aria-label="{FEATURE_LABELS[feature]} timeout" /></td>
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="hint">
		There is no mode that writes without you. The hub never passes
		<code>--dangerously-skip-permissions</code>, and the CLI is never given the vault as a working directory.
	</p>
</section>

<section class="card">
	<h3>Limits, enforced whatever a feature asks for</h3>
	<div class="kv">
		<b>Daily budget</b>
		<span><input type="number" min="0" max="100" step="0.5" bind:value={settings.budget.dailyUsd} data-testid="daily-budget" aria-label="Daily budget" /> US dollars</span>
		<b>Runs at once</b>
		<span><input type="number" min="1" max="4" bind:value={settings.budget.maxConcurrent} aria-label="Concurrent runs" /></span>
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
	<h3>The ten guardrails</h3>
	<ol class="rails">
		{#each Object.entries(GUARDRAILS) as [id, title] (id)}
			<li><span class="badge">{id}</span> {title}</li>
		{/each}
	</ol>
	<p class="hint">These are code paths, not instructions in a prompt. They hold whatever the model says.</p>
</section>

<style>
	.path { font: 12px var(--mono); }
	section { margin-bottom: 14px; }
	.switch { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; }
	table { border-collapse: collapse; width: 100%; font-size: 13px; }
	th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--line); }
	thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
	tbody th { font-weight: 500; }
	select, input {
		font: inherit;
		font-size: 13px;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 3px 6px;
		background: var(--panel);
		color: inherit;
	}
	input[type='number'] { width: 76px; }
	.actions { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
	.ok { color: var(--ok); font-size: 13px; }
	.bad { color: var(--bad); font-size: 13px; }
	.spend { margin: 0 0 8px; font-size: 13px; }
	.log { max-height: 300px; overflow: auto; font: 11px/1.6 var(--mono); white-space: pre; margin: 0; }
	.snaps { list-style: none; margin: 0; padding: 0; font-size: 13px; }
	.snaps li { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--line); }
	.when { font: 11px var(--mono); color: var(--muted); }
	.files { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rails { margin: 0; padding-left: 0; list-style: none; display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 16px; font-size: 13px; }
	.badge { font: 11px var(--mono); font-weight: 700; background: var(--soft); border-radius: 4px; padding: 1px 5px; }
	code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }
</style>

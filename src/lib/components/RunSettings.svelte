<script lang="ts">
	/**
	 * The per-run settings row: model, effort, permission, budget.
	 *
	 * It sits wherever a run is started rather than only on the settings page,
	 * because the user asked to pick these "for any feature that uses claude
	 * code" and a choice buried two pages away is not a choice made at the
	 * moment of use. It shows the defaults from `_hub/ai.md` and changes them
	 * for this run only; saving a new default is the settings page's job.
	 *
	 * The permission select can be locked. Ask and Insights are read-only by
	 * construction - there is no proposal for a chat answer to produce - so
	 * they show the mode rather than offering to change it, which is honest
	 * about what is actually possible.
	 */
	import { EFFORTS, MODELS, PERMISSION_MODES, type RunSettings } from '$lib/shared/ai';

	let {
		settings = $bindable(),
		lockPermission = false,
		compact = false
	}: { settings: RunSettings; lockPermission?: boolean; compact?: boolean } = $props();

	const mode = $derived(PERMISSION_MODES.find((m) => m.id === settings.permission));
</script>

<div class="run" class:compact data-testid="run-settings">
	<label>
		<span>Model</span>
		<select bind:value={settings.model} data-testid="run-model" aria-label="Model">
			{#each MODELS as model (model.id)}
				<option value={model.id} title={model.hint}>{model.label}</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Effort</span>
		<select bind:value={settings.effort} data-testid="run-effort" aria-label="Effort">
			{#each EFFORTS as effort (effort)}
				<option value={effort}>{effort}</option>
			{/each}
		</select>
	</label>

	<label>
		<span>Permission</span>
		{#if lockPermission}
			<span class="locked" data-testid="run-permission-locked" title="This feature only ever reads.">
				{mode?.label ?? settings.permission}
			</span>
		{:else}
			<select bind:value={settings.permission} data-testid="run-permission" aria-label="Permission">
				{#each PERMISSION_MODES as m (m.id)}
					<option value={m.id} title={m.hint}>{m.label}</option>
				{/each}
			</select>
		{/if}
	</label>

	<label class="budget">
		<span>Budget</span>
		<input
			type="number"
			min="0.01"
			max="2"
			step="0.05"
			bind:value={settings.budgetUsd}
			data-testid="run-budget"
			aria-label="Budget in dollars"
		/>
	</label>

	<span class="hint">{mode?.hint ?? ''}</span>
</div>

<style>
	.run {
		display: flex;
		align-items: center;
		gap: var(--s3);
		flex-wrap: wrap;
		padding: var(--s2) 10px;
		background: var(--soft);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		font-size: var(--t12);
	}
	.compact { padding: 6px var(--s2); gap: var(--s2); }
	label { display: flex; align-items: center; gap: 5px; }
	label span { color: var(--muted); }
	select,
	input {
		font: inherit;
		font-size: var(--t12);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 3px 6px;
		background: var(--field);
		color: inherit;
	}
	.budget input { width: 68px; }
	.locked { font-weight: 600; color: var(--text); }
	.hint { color: var(--muted); margin-left: auto; }
	.compact .hint { display: none; }
</style>

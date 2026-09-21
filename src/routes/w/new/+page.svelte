<script lang="ts">
	import { slugify } from '$lib/shared/slug';
	/**
	 * The new-workspace wizard.
	 *
	 * It writes one markdown file, so it shows exactly what that file will be
	 * called and which tag it will claim before anything is written. A name
	 * that is already taken is answered in the form: the server refuses rather
	 * than overwrites, and losing a half-filled form to an error page over a
	 * fixable typo would be rude.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { createWorkspace } from '$lib/client/cards';

	let { data } = $props();

	let name = $state('');
	let color = $state(untrack(() => data.colors[0]));
	let folders = $state('');
	let template = $state('project');
	let saving = $state(false);
	let problem = $state('');

	const slug = $derived(slugify(name));
	const taken = $derived(data.existing.find((w) => w.slug === slug));
	const folderList = $derived(
		folders
			.split(',')
			.map((f) => f.trim().replace(/^\/+|\/+$/g, ''))
			.filter(Boolean)
	);

	async function submit(event: Event) {
		event.preventDefault();
		if (!slug || taken || saving) return;
		saving = true;
		const result = await createWorkspace({ name: name.trim(), color, folders: folderList, template });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		await goto(`/w/${result.value.slug}`, { invalidateAll: true });
	}

</script>

<svelte:head><title>New workspace · prosoche</title></svelte:head>

<PageHeader title="New workspace" />
<p class="lead">
	A workspace is one markdown file in your vault. It says which folders and tag belong to it, and which
	widgets each of its tabs shows.
</p>

<form onsubmit={submit} class="card">
	<label class="field">
		<span>Name</span>
		<input bind:value={name} data-testid="ws-name" placeholder="Riverside Clinic" autocomplete="off" />
	</label>

	{#if slug}
		<p class="preview" data-testid="ws-preview">
			Writes <code>_hub/workspaces/{slug}.md</code> and claims <code>#ws/{slug}</code>.
		</p>
	{/if}
	{#if taken}
		<p class="problem" data-testid="ws-taken">
			“{taken.name}” already uses that file name. Pick a different name.
		</p>
	{/if}

	<div class="field">
		<span>Colour</span>
		<div class="swatches" role="radiogroup" aria-label="Colour">
			{#each data.colors as option (option)}
				<button
					type="button"
					class="swatch"
					class:chosen={color === option}
					style="--dot: {option}"
					role="radio"
					aria-checked={color === option}
					aria-label={option}
					data-testid="ws-color"
					onclick={() => (color = option)}
				></button>
			{/each}
		</div>
	</div>

	<label class="field">
		<span>Folders</span>
		<input
			bind:value={folders}
			data-testid="ws-folders"
			placeholder="Work/Atlas, Notes/Atlas"
			autocomplete="off"
		/>
	</label>
	<p class="hint">
		Comma separated, vault-relative. Notes and tasks inside them belong to this workspace; so does anything
		tagged <code>#ws/{slug || 'slug'}</code> wherever it lives. You can leave this empty and add folders later.
	</p>

	<div class="field">
		<span>Template</span>
		<div class="templates">
			{#each data.templates as option (option.name)}
				<label class="template" class:chosen={template === option.name}>
					<input type="radio" name="template" value={option.name} bind:group={template} data-testid="ws-template" />
					<b>{option.title}</b>
					<small>{option.tabs}</small>
				</label>
			{/each}
		</div>
	</div>

	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<div class="actions">
		<a class="btn" href="/">Cancel</a>
		<button class="btn primary" data-testid="ws-create" disabled={!slug || !!taken || saving}>
			{saving ? 'Creating…' : 'Create workspace'}
		</button>
	</div>
</form>

<style>
	.lead { color: var(--muted); font-size: 13px; margin: -8px 0 14px; max-width: 60ch; }
	form { max-width: 640px; display: flex; flex-direction: column; gap: 12px; }
	.field { display: flex; align-items: center; gap: 12px; }
	.field > span { flex: none; width: 90px; font-size: 12px; color: var(--muted); }
	.field input:not([type='radio']) {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
	}
	.swatches { display: flex; gap: 8px; }
	.swatch {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--dot);
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch.chosen { border-color: var(--text); }
	.templates { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; flex: 1; }
	.template {
		display: block;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 8px 10px;
		cursor: pointer;
		font-size: 13px;
	}
	.template.chosen { border-color: var(--accent); background: var(--accent-soft); }
	.template b { display: block; }
	.template small { color: var(--muted); font-size: 11px; }
	.template input { margin-right: 6px; }
	.preview { margin: 0; font-size: 12px; color: var(--muted); }
	.problem { margin: 0; font-size: 12px; color: var(--bad); }
	.hint { margin: -4px 0 0; }
	.actions { display: flex; gap: 8px; justify-content: flex-end; }
	code { font: 11px var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }

	@media (max-width: 720px) {
		.field { flex-direction: column; align-items: stretch; gap: 4px; }
		.field > span { width: auto; }
	}
</style>

<script lang="ts">
	/**
	 * The form for what a workspace's definition says about it: name,
	 * description, colour, tag and kind.
	 *
	 * Only the fields changed are sent, so saving a new name never adds a
	 * `template:` line the file did not have. The server writes each one in
	 * place and refuses what it will not have; the refusal is shown here and
	 * the form stays open. Folders are edited on the Overview, not here.
	 */
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';

	let {
		workspace,
		definitionHref,
		onclose
	}: {
		workspace: { slug: string; name: string; color: string; tag: string; template: string; description: string };
		definitionHref: string;
		onclose: () => void;
	} = $props();

	/** `study` is the only kind that changes anything: it makes a Study subject. */
	const KINDS = [
		{ value: 'project', label: 'Project' },
		{ value: 'study', label: 'Study subject' }
	];

	const initial = untrack(() => ({ ...workspace, template: workspace.template || 'project' }));
	let draft = $state({ ...initial });
	let saving = $state(false);
	let problem = $state('');

	const kinds = $derived(KINDS.some((k) => k.value === initial.template) ? KINDS : [...KINDS, { value: initial.template, label: initial.template }]);
	const tagChanged = $derived(draft.tag.trim().replace(/^#/, '') !== initial.tag);

	async function save(event: SubmitEvent) {
		event.preventDefault();
		const fields = ['name', 'description', 'color', 'tag', 'template'] as const;
		const changed = Object.fromEntries(fields.filter((f) => draft[f].trim() !== initial[f]).map((f) => [f, draft[f]]));
		if (!Object.keys(changed).length) return onclose();
		saving = true;
		problem = '';
		const result = await api('/api/workspace', { slug: workspace.slug, ...changed }, { method: 'PATCH' });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		await invalidateAll();
		onclose();
	}
</script>

<form class="sheet form" onsubmit={save} data-testid="workspace-details">
	<label class="form-row">
		<span>Name</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input class="field" bind:value={draft.name} autofocus autocomplete="off" data-testid="ws-edit-name" />
	</label>

	<label class="form-row">
		<span>Description</span>
		<textarea class="field" rows="2" bind:value={draft.description} placeholder="What this workspace is for, in a line" data-testid="ws-edit-description"></textarea>
	</label>

	<label class="form-row">
		<span>Colour</span>
		<input class="swatch" type="color" bind:value={draft.color} data-testid="ws-edit-color" />
		<code>{draft.color}</code>
	</label>

	<label class="form-row">
		<span>Tag</span>
		<input class="field" bind:value={draft.tag} autocomplete="off" spellcheck="false" data-testid="ws-edit-tag" />
	</label>
	{#if tagChanged}
		<p class="hint" data-testid="ws-edit-tag-hint">Tasks tagged <code>#{initial.tag}</code> keep that tag, and stop belonging here.</p>
	{/if}

	<label class="form-row">
		<span>Kind</span>
		<select class="field" bind:value={draft.template} data-testid="ws-edit-kind">
			{#each kinds as kind (kind.value)}
				<option value={kind.value}>{kind.label}</option>
			{/each}
		</select>
	</label>

	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

	<div class="actions">
		<a class="small" href={definitionHref}>Open the file</a>
		<button class="btn" type="button" onclick={onclose}>Cancel</button>
		<button class="btn primary" disabled={saving || !draft.name.trim()} data-testid="ws-edit-save">{saving ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	.form { max-width: 640px; padding: var(--s4); margin-bottom: var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
	.form-row { display: flex; align-items: center; gap: var(--s3); }
	.form-row > span { flex: none; width: 90px; font-size: var(--t12); color: var(--muted); }
	.swatch { width: var(--s6, 40px); height: 32px; padding: 0; border: 1px solid var(--line); border-radius: var(--r-md); background: none; cursor: pointer; }
	.hint { margin: -4px 0 0 96px; }
	.actions { display: flex; align-items: center; gap: var(--s2); justify-content: flex-end; }
	.actions a { margin-right: auto; }
	code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }

	@media (max-width: 720px) {
		.form-row { flex-direction: column; align-items: stretch; gap: var(--s1); }
		.form-row > span { width: auto; }
		.hint { margin-left: 0; }
	}
</style>

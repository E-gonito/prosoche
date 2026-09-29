<script lang="ts">
	/**
	 * The new-workspace wizard.
	 *
	 * It writes one markdown file, so it shows exactly what that file will be
	 * called and which tag it will claim before anything is written. A name
	 * that is already taken is answered in the form: the server refuses rather
	 * than overwrites.
	 *
	 * There is no widget or tab choice here any more: every workspace gets the
	 * same sections (Overview, Tasks, Inbox, Log, People, Notes), and a section
	 * with nothing in it hides itself.
	 */
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { slugify } from '$lib/shared/slug';
	import { createWorkspace } from '$lib/client/cards';

	let { data } = $props();

	let name = $state('');
	let color = $state(untrack(() => data.colors[0]));
	let folders = $state('');
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
		const result = await createWorkspace({ name: name.trim(), color, folders: folderList });
		saving = false;
		if (!result.ok) {
			problem = result.message;
			return;
		}
		await goto(`/w/${result.value.slug}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>New workspace · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>New workspace</h1>
		<p>A workspace is one markdown file that names its folders, its tag and its colour.</p>
	</div>

	<form onsubmit={submit} class="sheet form">
		<label class="field">
			<span>Name</span>
			<input bind:value={name} data-testid="ws-name" placeholder="Riverside Clinic" autocomplete="off" />
		</label>

		{#if slug}
			<p class="hint" data-testid="ws-preview">
				Writes <code>_hub/workspaces/{slug}.md</code> and claims <code>#ws/{slug}</code>.
			</p>
		{/if}
		{#if taken}
			<p class="problem" data-testid="ws-taken">"{taken.name}" already uses that file name. Pick a different name.</p>
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
			<input bind:value={folders} data-testid="ws-folders" placeholder="Work/Atlas, Notes/Atlas" autocomplete="off" />
		</label>
		<p class="hint">Comma separated, vault-relative; anything tagged <code>#ws/{slug || 'slug'}</code> belongs here too.</p>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		<div class="actions">
			<a class="btn" href="/w">Cancel</a>
			<button class="btn primary" data-testid="ws-create" disabled={!slug || !!taken || saving}>
				{saving ? 'Creating…' : 'Create workspace'}
			</button>
		</div>
	</form>
</div>

<style>
	.form { max-width: 640px; padding: var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
	.field { display: flex; align-items: center; gap: var(--s3); }
	.field > span { flex: none; width: 90px; font-size: var(--t12); color: var(--muted); }
	.field input {
		flex: 1;
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		padding: var(--s2) 10px;
		font: inherit;
		background: var(--field);
	}
	.swatches { display: flex; gap: var(--s2); }
	.swatch {
		width: var(--s5);
		height: var(--s5);
		border-radius: 50%;
		background: var(--dot);
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch.chosen { border-color: var(--text); }
	.hint { margin: -4px 0 0 96px; }
	.actions { display: flex; gap: var(--s2); justify-content: flex-end; }
	code { font: var(--t11) var(--mono); background: var(--soft); border-radius: 4px; padding: 1px 5px; }

	@media (max-width: 720px) {
		.field { flex-direction: column; align-items: stretch; gap: var(--s1); }
		.field > span { width: auto; }
		.hint { margin-left: 0; }
	}
</style>

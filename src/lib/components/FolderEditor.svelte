<script lang="ts">
	/**
	 * A list of vault folders to edit: each removable, and a field to add one.
	 * By default it is which folders a workspace reads: its home, fixed, then
	 * the reference folders. With `home` off every folder is removable, as
	 * for the folders a glossary is scanned from, and `save` says where the
	 * list is written.
	 *
	 * Every add or remove is saved at once and the page reloaded, so what is
	 * shown is always what the file says. The field suggests `options` but
	 * takes any path, and the server refuses one it will not have.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api, type Result } from '$lib/client/api';

	let {
		slug,
		folders,
		options,
		home: fixed = true,
		save: write,
		hint = "Notes in these folders, and anything tagged with the workspace's tag, count as its own.",
		empty = 'No folders yet. The first one you add becomes its home.',
		disabled = false
	}: {
		/** The workspace, when `save` is the default; also keeps the suggestions' id unique. */
		slug: string;
		folders: string[];
		options: string[];
		/** True when the first folder is the workspace's home, which does not move. */
		home?: boolean;
		/** Writes the whole new list; by default, as the workspace's `folders:`. */
		save?: (next: string[]) => Promise<Result<unknown>>;
		hint?: string;
		empty?: string;
		/** Set while something else is using the list. */
		disabled?: boolean;
	} = $props();

	const home = $derived(fixed ? (folders[0] ?? null) : null);
	const refs = $derived(fixed ? folders.slice(1) : folders);
	const offered = $derived(options.filter((f) => !folders.includes(f)));

	let adding = $state('');
	let busy = $state(false);
	let problem = $state('');

	async function save(next: string[]) {
		busy = true;
		problem = '';
		const result = await (write ? write(next) : api('/api/workspace', { slug, folders: next }, { method: 'PATCH' }));
		busy = false;
		if (!result.ok) {
			problem = result.message;
			return false;
		}
		await invalidateAll();
		return true;
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		const folder = adding.trim().replace(/^\/+|\/+$/g, '');
		if (!folder || disabled) return;
		// With no home yet, the first folder added becomes it.
		if (await save(home || !fixed ? [...refs, folder] : [folder])) adding = '';
	}
</script>

<div class="sheet folders" data-testid="folders">
	{#if home || refs.length}
		<div class="chips" data-testid="folder-chips">
			{#if home}<span class="chip quiet" title="Where this workspace writes its own files. It does not move.">{home}/ <em>home</em></span>{/if}
			{#each refs as folder (folder)}
				<span class="chip"
					><span class="path">{folder}/</span><button type="button" class="x" aria-label="Stop reading {folder}" disabled={busy || disabled} onclick={() => save(refs.filter((f) => f !== folder))}>×</button></span
				>
			{/each}
		</div>
	{:else}
		<p class="empty">{empty}</p>
	{/if}

	<form class="add-row" onsubmit={add}>
		<input class="field" list="folders-{slug}" bind:value={adding} placeholder="Add a folder, e.g. Papers/ML" aria-label="Add a folder" data-testid="folder-input" />
		<datalist id="folders-{slug}">
			{#each offered as folder (folder)}<option value={folder}></option>{/each}
		</datalist>
		<button class="btn" disabled={busy || disabled || !adding.trim()}>Add</button>
	</form>
	{#if problem}<p class="problem">{problem}</p>{/if}
	{#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
	.chips { margin-bottom: var(--s3); }
	.chip { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
	.chip em { font-style: normal; color: var(--muted); font-size: var(--t11); }
	.path { overflow-wrap: anywhere; }
	.hint { margin-bottom: 0; }
</style>

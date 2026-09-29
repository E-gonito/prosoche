<script lang="ts">
	/**
	 * Which vault folders a workspace reads: its home, fixed, then the
	 * reference folders, each removable, and a field to add one.
	 *
	 * Every add or remove is saved at once and the page reloaded, so what is
	 * shown is always what the definition file says. The field suggests every
	 * folder in the vault but takes any path, since a folder need not exist
	 * before a workspace is pointed at it.
	 */
	import { invalidateAll } from '$app/navigation';
	import { setWorkspaceFolders } from '$lib/client/api';

	let { slug, folders, options }: { slug: string; folders: string[]; options: string[] } = $props();

	const home = $derived(folders[0] ?? null);
	const refs = $derived(folders.slice(1));
	const offered = $derived(options.filter((f) => !folders.includes(f)));

	let adding = $state('');
	let busy = $state(false);
	let problem = $state('');

	async function save(next: string[]) {
		busy = true;
		problem = '';
		const result = await setWorkspaceFolders(slug, next);
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
		const folder = adding.trim();
		if (!folder) return;
		// With no home yet, the first folder added becomes it.
		if (await save(home ? [...refs, folder] : [folder])) adding = '';
	}
</script>

<div class="sheet folders" data-testid="folders">
	{#if home}
		<div class="chips">
			<span class="chip quiet" title="Where this workspace writes its own files. It does not move.">{home}/ <em>home</em></span>
			{#each refs as folder (folder)}
				<span class="chip"
					><span class="path">{folder}/</span><button type="button" class="x" aria-label="Stop reading {folder}" disabled={busy} onclick={() => save(refs.filter((f) => f !== folder))}>×</button></span
				>
			{/each}
		</div>
	{:else}
		<p class="none">No folders yet. The first one you add becomes its home.</p>
	{/if}

	<form class="add" onsubmit={add}>
		<input class="field" list="folders-{slug}" bind:value={adding} placeholder="Add a folder, e.g. Papers/ML" aria-label="Add a folder" data-testid="folder-input" />
		<datalist id="folders-{slug}">
			{#each offered as folder (folder)}<option value={folder}></option>{/each}
		</datalist>
		<button class="btn" disabled={busy || !adding.trim()}>Add</button>
	</form>
	{#if problem}<p class="problem">{problem}</p>{/if}
	<p class="hint">Notes in these folders, and anything tagged with the workspace's tag, count as its own.</p>
</div>

<style>
	.chips { margin-bottom: var(--s3); }
	.chip { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
	.chip em { font-style: normal; color: var(--muted); font-size: var(--t11); }
	.path { overflow-wrap: anywhere; }
	.x { border: 0; background: none; color: var(--muted); font-size: var(--t15); line-height: 1; padding: 0 2px; cursor: pointer; }
	.x:hover { color: var(--bad); }
	.add { display: flex; gap: var(--s2); }
	.add .field { flex: 1; min-width: 0; }
	.hint { margin-bottom: 0; }
</style>

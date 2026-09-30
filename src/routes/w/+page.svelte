<script lang="ts">
	/**
	 * Every workspace, at a glance: what it is, what is open, and when it was
	 * last touched. Each row's Edit and Delete are the shared `EditDetails`,
	 * as on every module's list; a workspace's own page only shows them.
	 */
	import { invalidateAll } from '$app/navigation';
	import EditDetails from '$lib/components/EditDetails.svelte';
	import { api, saveWorkspace } from '$lib/client/api';

	let { data } = $props();

	/** Reload once a write has gone through, and hand its result back either way. */
	async function reloaded<T extends { ok: boolean }>(result: T): Promise<T> {
		if (result.ok) await invalidateAll();
		return result;
	}
</script>

<svelte:head><title>Workspaces · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Workspaces</h1>
		<p>The areas a vault is divided into: work, clients, and whatever else you split off.</p>
	</div>

	<div class="sheet rows">
		{#each data.workspaces as w (w.slug)}
			<div class="line">
				<a class="row" href="/w/{w.slug}" data-testid="workspace-row">
					<span class="dot lg" style="--dot: {w.color}"></span>
					<span class="main">
						<b>{w.name}</b>
						{#if w.description}<span class="muted small desc">{w.description}</span>{/if}
					</span>
					<span class="figures">
						<span class="num" title="Open tasks">{w.openTasks} open</span>
						<span class="num" title="Unfiled inbox lines">{w.inboxCount} inbox</span>
						{#if w.latestLog}<span class="muted small">last logged {w.latestLog}</span>{/if}
					</span>
				</a>
				<EditDetails
					details={w}
					fields={['name', 'description', 'color', 'tag']}
					fileHref={w.fileHref}
					save={async (changed) => reloaded(await saveWorkspace(w.slug, changed))}
					remove={async () => reloaded(await api('/api/workspace', { slug: w.slug }, { method: 'DELETE' }))}
					ask="Delete this workspace? Only its file in _hub/workspaces goes; its folders and notes stay."
				/>
			</div>
		{:else}
			<p class="empty">No workspaces yet.</p>
		{/each}
	</div>

	<p><a class="btn" href="/w/new" data-testid="new-workspace">New workspace</a></p>
</div>

<style>
	.line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) var(--s3); padding-right: var(--s2); border-top: 1px solid var(--line); }
	.line:first-child { border-top: 0; }
	.row { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s2); color: var(--text); }
	.row:hover { text-decoration: none; background: var(--soft); }
	.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.figures { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: var(--t12); color: var(--muted); }

	@media (max-width: 720px) {
		.row { flex-wrap: wrap; }
		.figures { flex-direction: row; align-items: center; }
	}
</style>

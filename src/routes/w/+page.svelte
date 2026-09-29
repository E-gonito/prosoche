<script lang="ts">
	/**
	 * Every workspace, at a glance: what it is, what is open, and when it was
	 * last touched.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Workspaces · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Workspaces</h1>
		<p>The areas a vault is divided into: work, study, and whatever else you split off.</p>
	</div>

	<div class="sheet rows">
		{#each data.workspaces as w (w.slug)}
			<a class="row" href="/w/{w.slug}" data-testid="workspace-row">
				<span class="dot" style="--dot: {w.color}"></span>
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
		{:else}
			<p class="none">No workspaces yet.</p>
		{/each}
	</div>

	<p><a class="btn" href="/w/new" data-testid="new-workspace">New workspace</a></p>
</div>

<style>
	.row { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s2); border-top: 1px solid var(--line); color: var(--text); }
	.row:first-child { border-top: 0; }
	.row:hover { text-decoration: none; background: var(--soft); }
	.dot { flex: none; width: 11px; height: 11px; border-radius: 50%; background: var(--dot); }
	.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.figures { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: var(--t12); color: var(--muted); }

	@media (max-width: 720px) {
		.row { flex-wrap: wrap; }
		.figures { flex-direction: row; align-items: center; }
	}
</style>

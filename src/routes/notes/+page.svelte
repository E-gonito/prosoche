<script lang="ts">
	/**
	 * The way into the vault: the folders, and what you actually touched.
	 *
	 * A tree alone answers "where is that note filed", which is the rarer
	 * question. Almost every visit here is a return to something from the last
	 * day or two, so the recent list sits beside the tree rather than under it,
	 * and today's daily note — the one note that is always the answer — is a
	 * button in the header instead of six clicks down the Journal folder.
	 */
	import FileTree from '$lib/components/FileTree.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { relativeDay } from '$lib/shared/time';

	let { data } = $props();

	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
</script>

<svelte:head><title>Notes · prosoche</title></svelte:head>

<PageHeader title="Notes">
	{#snippet meta()}
		<span>{data.health.notes} notes · {data.health.tasks} tasks</span>
	{/snippet}
	{#snippet actions()}
		<a class="btn" href={href(data.todayNote)} data-testid="today-note">
			<Icon name="calendar" /> Today's note
		</a>
	{/snippet}
</PageHeader>

<div class="columns">
	<section class="card">
		<h3>Folders</h3>
		<FileTree nodes={data.tree} />
	</section>

	<section class="card">
		<h3>Recent</h3>
		{#if data.recent.length}
			<ul data-testid="recent-notes">
				{#each data.recent as note (note.path)}
					<li>
						<a href={href(note.path)}>{note.title}</a>
						<span class="when">{relativeDay(note.day, data.today)}</span>
						<span class="where">{note.folder || 'the vault root'}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint">Nothing in the vault yet.</p>
		{/if}
	</section>
</div>

<style>
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		align-items: start;
		gap: var(--s4);
	}

	ul { list-style: none; margin: 0; padding: 0; }
	li {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0 10px;
		padding: 7px 0;
		border-top: 1px solid var(--line);
	}
	li:first-child { border-top: 0; }
	a { text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	a:hover { text-decoration: underline; }
	/* A date, so body text with the figures lined up rather than monospace. */
	.when { font-size: var(--t11); font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
	.where { grid-column: 1 / 2; font-size: var(--t11); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* One column: two of these side by side would be a column each of ellipsis. */
	@media (max-width: 720px) {
		.columns { grid-template-columns: 1fr; }
	}
</style>

<script lang="ts">
	/**
	 * A workspace's overview: its board, its master note, what came in, what
	 * happened last, and where the notes are.
	 *
	 * The board is where the work is done; every other section links to the
	 * tab that goes deeper, so the rest of the page is a summary. Folders is
	 * the one other thing edited here: which parts of the vault it reads.
	 */
	import Board from '$lib/components/board/Board.svelte';
	import MasterNote from '$lib/components/MasterNote.svelte';
	import FolderEditor from '$lib/components/FolderEditor.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	const slug = $derived(data.workspace?.slug);
</script>

<section>
	<p class="label">
		Board
		{#if data.board.exists}<span class="right"><a href={noteHref(data.board.path)}>Board.md</a></span>{/if}
	</p>
	<Board board={data.board} today={data.today} />
</section>

<section>
	<p class="label">Overview</p>
	<MasterNote {...data.overview} />
</section>

<div class="split">
	<section>
		<p class="label">Inbox <span class="right"><a href="/w/{slug}/inbox">Inbox</a></span></p>
		<div class="sheet rows">
			{#each data.inboxPreview as line (line)}
				<p class="capture">{line.replace(/^[ \t]*[-*+][ \t]+/, '')}</p>
			{:else}
				<p class="none">Nothing captured yet.</p>
			{/each}
		</div>
	</section>

	<section>
		<p class="label">Log <span class="right"><a href="/w/{slug}/log">Log</a></span></p>
		{#if data.latestLog}
			<div class="sheet rows">
				<p class="day">{data.latestLog.day}</p>
				{#each data.latestLog.lines as line (line)}
					<p class="capture">{line.replace(/^[ \t]*[-*+][ \t]+/, '')}</p>
				{/each}
			</div>
		{:else}
			<div class="sheet rows"><p class="none">No sessions logged yet.</p></div>
		{/if}
	</section>
</div>

<section>
	<p class="label">Recent notes <span class="right"><a href="/w/{slug}/notes">Notes</a></span></p>
	<div class="sheet rows">
		{#each data.notes as note (note.path)}
			<a class="row" href={noteHref(note.path)}>
				<span>{note.title}</span>
				<span class="muted small">{note.day}</span>
			</a>
		{:else}
			<p class="none">No notes in this workspace's folders yet.</p>
		{/each}
	</div>
</section>

<section>
	<p class="label">Folders</p>
	<FolderEditor slug={data.workspace.slug} folders={data.workspace.folders} options={data.vaultFolders} />
</section>

<style>
	section { margin-bottom: var(--s5); }
	.split { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s5); }
	.day { margin: 0; padding: var(--s2) var(--s1) 0; font: 600 var(--t12) inherit; color: var(--muted); }
	.capture { margin: 0; padding: var(--s1); font-size: var(--t13); border-top: 1px solid var(--line); }
	.capture:first-of-type { border-top: 0; }
	.row { display: flex; justify-content: space-between; gap: var(--s2); padding: var(--s2) var(--s1); border-top: 1px solid var(--line); color: var(--text); }
	.row:first-child { border-top: 0; }
	.row:hover { text-decoration: none; background: var(--soft); }

	@media (max-width: 720px) {
		.split { grid-template-columns: 1fr; }
	}
</style>

<script lang="ts">
	/** A workspace's own notes, read-only: editing is Obsidian's job, same as the vault-wide Notes module. */
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
</script>

<p class="label">Notes <span class="right">{data.total}</span></p>
<div class="sheet rows">
	{#each data.notes as note (note.path)}
		<a class="row" href={noteHref(note.path)}>
			<span>{note.title}</span>
			<span class="muted small">{note.folder} · {note.day}</span>
		</a>
	{:else}
		<p class="none">No notes in this workspace's folders yet.</p>
	{/each}
</div>

<style>
	.row { display: flex; justify-content: space-between; gap: var(--s3); padding: var(--s2); border-top: 1px solid var(--line); color: var(--text); }
	.row:first-child { border-top: 0; }
	.row:hover { text-decoration: none; background: var(--soft); }
</style>

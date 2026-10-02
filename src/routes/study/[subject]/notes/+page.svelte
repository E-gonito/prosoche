<script lang="ts">
	/**
	 * A subject's notes, from its own folders in the vault: a tree to browse
	 * on the left and the chosen note read in place on the right. On a phone
	 * the tree sits above the note. A filter box narrows the tree to a flat
	 * list of matching note names.
	 *
	 * Read-only: editing stays in Obsidian. The note links on to the vault-wide
	 * reader. Below it, which folders the subject's notes come from, to edit.
	 */
	import FileTree from '$lib/components/FileTree.svelte';
	import FolderEditor from '$lib/components/FolderEditor.svelte';
	import { api } from '$lib/client/api';
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	type Node = (typeof data.tree)[number];

	let query = $state('');
	const base = $derived(`/study/${data.subject.slug}`);
	const hrefFor = (path: string) => `${base}/notes?note=${encodeURIComponent(path)}`;
	const nameOf = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');

	const flatten = (nodes: Node[]): string[] => nodes.flatMap((n) => (n.type === 'note' ? [n.path] : flatten(n.children)));
	const needle = $derived(query.trim().toLowerCase());
	const matches = $derived(needle ? flatten(data.tree).filter((p) => p.toLowerCase().includes(needle)) : []);
</script>

<svelte:head><title>{data.note ? `${data.note.title} · ` : ''}Notes · {data.subject.name} · prosoche</title></svelte:head>

<div class="page wide">
	<StudyTabs subject={data.subject} lede="Your notes from this subject's folders, straight from the vault." />

	{#if data.tree.length === 0}
		<p class="callout" data-testid="subject-no-notes">
			<b>No folders yet.</b> This subject's folders ({data.folders.join(', ') || 'none'}) hold no notes. Add a folder
			below to see its notes here.
		</p>
	{:else}
		<div class="layout">
			<aside class="sheet" data-testid="subject-tree">
				<input class="field" type="search" bind:value={query} placeholder="Filter {data.count} notes…" aria-label="Filter notes" data-testid="subject-notes-filter" />
				{#if needle}
					<ul class="matches">
						{#each matches as path (path)}
							<li><a href={hrefFor(path)} class:active={path === data.note?.path}>{nameOf(path)}<small>{path.slice(0, path.lastIndexOf('/'))}</small></a></li>
						{:else}
							<li class="empty">No note matches.</li>
						{/each}
					</ul>
				{:else}
					<FileTree nodes={data.tree} openPath={data.note?.path ?? ''} openDepth={1} {hrefFor} />
				{/if}
			</aside>

			<article class="sheet reader">
				{#if data.note}
					<div class="note-head">
						<h2>{data.note.title}</h2>
						<div class="actions">
							<a class="btn ghost small" href={noteHref(data.note.path)}>Open in Notes</a>
						</div>
					</div>
					<p class="path">{data.note.path}</p>
					{#if data.note.tags.length}<div class="chips">{#each data.note.tags as tag (tag)}<span class="tag">#{tag}</span>{/each}</div>{/if}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="prose" data-testid="subject-note-body">{@html data.note.html}</div>
				{:else if data.missing}
					<p class="empty">That note is not in {data.subject.name}'s folders any more: <code>{data.missing}</code>.</p>
				{:else}
					<p class="empty">Pick a note on the left to read it here.</p>
				{/if}
			</article>
		</div>
	{/if}

	<p class="label">Folders</p>
	<FolderEditor
		slug={data.subject.slug}
		folders={data.folders}
		options={data.vaultFolders}
		save={(folders) => api('/api/study/subject', { subject: data.subject.slug, folders }, { method: 'PATCH' })}
		hint="Notes in these folders count as this subject's, and this tab shows them."
	/>
</div>

<style>
	.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: var(--s4); align-items: start; }
	aside { position: sticky; top: var(--s4); max-height: calc(100dvh - 2 * var(--s4)); overflow: auto; padding: var(--s3); }
	aside .field { margin-bottom: var(--s2); }
	.matches { list-style: none; margin: 0; padding: 0; font-size: var(--t13); }
	.matches a { display: flex; flex-direction: column; padding: 4px 6px; border-radius: var(--r-sm); color: var(--text); }
	.matches a:hover { background: var(--soft); text-decoration: none; }
	.matches a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
	.matches small { color: var(--muted); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.reader { min-height: 240px; }
	.note-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
	.note-head h2 { margin: 0; font-family: var(--serif); font-size: var(--t24); }
	.actions { display: flex; gap: var(--s2); }
	.path { margin: var(--s1) 0 var(--s3); font: var(--t12) var(--mono); color: var(--muted); overflow-wrap: anywhere; }
	.chips { display: flex; flex-wrap: wrap; gap: var(--s1); margin-bottom: var(--s3); }
	.tag { font-size: var(--t12); color: var(--muted); }

	@media (max-width: 900px) {
		.layout { grid-template-columns: 1fr; }
		aside { position: static; max-height: 45dvh; }
	}
</style>

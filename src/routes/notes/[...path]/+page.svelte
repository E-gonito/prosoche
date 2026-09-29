<script lang="ts">
	/**
	 * A note, read-only: its text, and the notes around it.
	 *
	 * The side column holds what the note says about itself (properties and
	 * tags) and its links in both directions. On a phone it drops under the
	 * text. The folder tree is a sheet behind the Browse button, because a
	 * note is for reading and the tree is for finding the next one.
	 */
	import { invalidateAll } from '$app/navigation';
	import FileTree from '$lib/components/FileTree.svelte';
	import Draft from '$lib/components/Draft.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();
	let sheet: HTMLDialogElement | undefined = $state();

	const backlinkCount = $derived(new Set(data.backlinks.map((b) => b.path)).size);
	const uniqueBacklinks = $derived([...new Map(data.backlinks.map((b) => [b.path, b])).values()]);

	/** A click on the backdrop or on a note in the tree closes the sheet. */
	function dismiss(event: MouseEvent) {
		const target = event.target;
		if (target === sheet || (target instanceof HTMLElement && target.closest('a'))) sheet?.close();
	}
</script>

<svelte:head><title>{data.title} · prosoche</title></svelte:head>

<div class="page wide">
	<div class="head">
		<a class="crumb" href="/notes">Notes</a>{#if data.folder}<span class="crumb"> / {data.folder}</span>{/if}
		<div class="actions">
			{#if data.subject}
				<Draft
					label="Make cards"
					title="Draft flashcards for {data.subject} from this note. Nothing reaches the note until you accept it."
					request={{ feature: 'suggest-flashcards', path: data.path }}
					ondone={() => invalidateAll()}
				/>
			{/if}
			<button class="btn ghost" onclick={() => sheet?.showModal()} data-testid="open-files"><Icon name="file-text" /> Browse</button>
		</div>
	</div>

	<div class="layout">
		<article>
			{#if data.conflicted}
				<p class="callout" data-testid="conflict">
					<b>Unfinished merge.</b> This note has git conflict markers. Resolve it in Obsidian or on the <a href="/sync">sync page</a>.
				</p>
			{/if}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="prose" data-testid="note-body">{@html data.html}</div>
		</article>

		<aside>
			{#if data.frontmatter.length || data.tags.length}
				<p class="label">About</p>
				{#if data.frontmatter.length}
					<dl>
						{#each data.frontmatter as [key, value] (key)}
							<dt>{key}</dt><dd>{value}</dd>
						{/each}
					</dl>
				{/if}
				{#if data.tags.length}
					<div class="chips">{#each data.tags as tag (tag)}<span class="tag">#{tag}</span>{/each}</div>
				{/if}
			{/if}

			<p class="label">Linked here <span class="right">{backlinkCount}</span></p>
			{#each uniqueBacklinks as link (link.path)}
				<a class="link" href={noteHref(link.path)}>{link.title}</a>
			{:else}
				<p class="none">Nothing links here.</p>
			{/each}

			{#if data.outgoing.length}
				<p class="label">Links out <span class="right">{data.outgoing.length}</span></p>
				{#each data.outgoing as link (link.path)}
					<a class="link" href={noteHref(link.path)}>{link.target}</a>
				{/each}
			{/if}
		</aside>
	</div>
</div>

<dialog class="files" bind:this={sheet} onclick={dismiss}>
	<div class="files-body">
		<p class="label">Browse the vault <button class="icon-btn right" onclick={() => sheet?.close()} aria-label="Close"><Icon name="x" /></button></p>
		<FileTree nodes={data.tree} openPath={data.path} />
	</div>
</dialog>

<style>
	.head { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s4); flex-wrap: wrap; }
	.crumb { font-size: var(--t13); color: var(--muted); }
	.actions { margin-left: auto; display: flex; gap: var(--s1); }
	.layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: var(--s6); align-items: start; }
	article { min-width: 0; max-width: 760px; }
	aside { position: sticky; top: var(--s5); font-size: var(--t14); }
	aside .label:first-child { margin-top: 0; }
	.link { display: block; padding: 3px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--s3); margin: 0 0 var(--s3); }
	dt { color: var(--muted); }
	dd { margin: 0; overflow-wrap: anywhere; }
	.callout { margin: 0 0 var(--s4); }

	dialog.files {
		margin: 0 0 0 auto;
		height: 100vh;
		max-height: none;
		width: min(420px, 100%);
		border: 0;
		padding: 0;
		background: var(--panel);
		box-shadow: var(--shadow-lg);
	}
	dialog.files::backdrop { background: rgba(42, 38, 34, 0.3); }
	.files-body { padding: var(--s5); }

	@media (max-width: 1100px) {
		.layout { grid-template-columns: 1fr; gap: var(--s4); }
		aside { position: static; border-top: 1px solid var(--line); padding-top: var(--s4); }
	}
</style>

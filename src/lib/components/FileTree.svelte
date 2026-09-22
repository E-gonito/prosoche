<script lang="ts">
	// Recursive folder tree. Folders start closed except the one containing the
	// open note, which the parent expands by passing `openPath`.
	import Self from './FileTree.svelte';

	type Node =
		| { type: 'folder'; name: string; path: string; children: Node[] }
		| { type: 'note'; name: string; path: string };

	let { nodes, openPath = '', depth = 0 }: { nodes: Node[]; openPath?: string; depth?: number } = $props();

	const href = (path: string) => `/notes/${path.split('/').map(encodeURIComponent).join('/')}`;
	const containsOpen = (node: Extract<Node, { type: 'folder' }>) => openPath.startsWith(node.path + '/');
</script>

<ul class:nested={depth > 0}>
	{#each nodes as node (node.path)}
		{#if node.type === 'folder'}
			<li>
				<details open={containsOpen(node)}>
					<summary>{node.name}</summary>
					<Self nodes={node.children} {openPath} depth={depth + 1} />
				</details>
			</li>
		{:else}
			<li>
				<a href={href(node.path)} class:active={node.path === openPath}>{node.name}</a>
			</li>
		{/if}
	{/each}
</ul>

<style>
	ul { list-style: none; margin: 0; padding: 0; font-size: var(--t13); }
	ul.nested { padding-left: var(--s3); }
	li { margin: 0; }
	summary { cursor: pointer; padding: 3px 6px; border-radius: var(--r-sm); color: var(--muted); user-select: none; }
	summary:hover { background: var(--soft); }
	a {
		display: block;
		padding: 3px 6px;
		border-radius: var(--r-sm);
		color: var(--text);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	a:hover { background: var(--soft); }
	a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
</style>

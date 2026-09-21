<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import FileTree from '$lib/components/FileTree.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import Draft from '$lib/components/Draft.svelte';
	import ResizeHandle from '$lib/components/ResizeHandle.svelte';
	import { Pane } from '$lib/client/pane.svelte';
	import { fitPanes } from '$lib/shared/panes';

	let { data } = $props();

	const TREE = { min: 160, max: 520 };
	const RAIL = { min: 180, max: 520 };
	const tree = new Pane('notes-tree', TREE, 230);
	const rail = new Pane('notes-rail', RAIL, 240);

	let layout: HTMLDivElement | undefined = $state();
	let available = $state(1200);

	$effect(() => {
		tree.restore();
		rail.restore();
	});

	// Track the width available, so the editor keeps a usable minimum when the
	// window shrinks rather than the panes simply overflowing.
	$effect(() => {
		if (!layout) return;
		const observer = new ResizeObserver(([entry]) => (available = entry.contentRect.width));
		observer.observe(layout);
		return () => observer.disconnect();
	});

	const widths = $derived(
		fitPanes(available, [
			{ width: tree.width, collapsed: tree.collapsed, limits: TREE },
			{ width: rail.width, collapsed: rail.collapsed, limits: RAIL }
		])
	);

	const href = (p: string) => `/notes/${p.split('/').map(encodeURIComponent).join('/')}`;
	const openCount = $derived(data.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length);

	/**
	 * A wikilink clicked inside the editor. A link this note already resolves
	 * goes straight there; anything else goes to search, which is more useful
	 * than doing nothing when the name is a near miss.
	 */
	function navigate(target: string) {
		const match = data.outgoing.find((l) => l.target === target)?.path;
		goto(match ? href(match) : `/search?q=${encodeURIComponent(target)}`);
	}

	/** Pointer x to a width, measured from whichever edge the pane sits on. */
	function widthFromLeft(clientX: number): number {
		return clientX - (layout?.getBoundingClientRect().left ?? 0);
	}
	function widthFromRight(clientX: number): number {
		return (layout?.getBoundingClientRect().right ?? 0) - clientX;
	}
</script>

<svelte:head><title>{data.title} · prosoche</title></svelte:head>

<div
	class="layout"
	bind:this={layout}
	style="--tree: {widths[0]}px; --rail: {widths[1]}px"
	class:tree-collapsed={tree.collapsed}
	class:rail-collapsed={rail.collapsed}
>
	{#if tree.collapsed}
		<button
			class="rail-tab left"
			onclick={() => tree.toggle()}
			aria-label="Show the file tree"
			title="Show the file tree"
		>Files</button>
	{:else}
		<aside class="card pane tree">
			<div class="pane-head">
				<span>Files</span>
				<button class="collapse" onclick={() => tree.toggle()} aria-label="Hide the file tree" title="Hide">‹</button>
			</div>
			<div class="pane-body"><FileTree nodes={data.tree} openPath={data.path} /></div>
		</aside>
		<ResizeHandle
			label="Resize the file tree"
			value={tree.width}
			min={TREE.min}
			max={TREE.max}
			onmove={(x) => tree.resize(widthFromLeft(x))}
			onnudge={(d) => tree.nudge(d)}
			ondoubleclick={() => tree.toggle()}
		/>
	{/if}

	<article class="card note-pane">
		<div class="crumb">
			<span>{data.path}</span>
			<a class="btn ghost" href="{href(data.path)}?edit={data.editing ? '0' : '1'}">
				{data.editing ? 'Reading view' : 'Edit'}
			</a>
		</div>

		{#if data.editing}
			{#key data.path}
				<Editor
					path={data.path}
					content={data.content}
					hash={data.hash}
					noteNames={data.noteNames}
					onnavigate={navigate}
				/>
			{/key}
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="prose">{@html data.html}</div>
		{/if}
	</article>

	{#if rail.collapsed}
		<button
			class="rail-tab right"
			onclick={() => rail.toggle()}
			aria-label="Show links and properties"
			title="Show links and properties"
		>Links</button>
	{:else}
		<ResizeHandle
			label="Resize the links panel"
			value={rail.width}
			min={RAIL.min}
			max={RAIL.max}
			onmove={(x) => rail.resize(widthFromRight(x))}
			onnudge={(d) => rail.nudge(-d)}
			ondoubleclick={() => rail.toggle()}
		/>
		<aside class="pane rail">
			<div class="pane-head card-less">
				<span>Links</span>
				<button class="collapse" onclick={() => rail.toggle()} aria-label="Hide links and properties" title="Hide">›</button>
			</div>
			<div class="pane-body stack">
				{#if Object.keys(data.frontmatter).length}
					<div class="card">
						<h3>Properties</h3>
						<div class="kv">
							{#each Object.entries(data.frontmatter) as [key, value] (key)}
								<b>{key}</b><span>{Array.isArray(value) ? value.join(', ') : String(value)}</span>
							{/each}
						</div>
					</div>
				{/if}

				{#if data.tasks.length}
					<div class="card">
						<h3>Tasks <span class="right">{openCount} open of {data.tasks.length}</span></h3>
						<div class="counts">
							{#each [1, 2, 3, 4] as q (q)}
								{@const n = data.tasks.filter((t) => t.quadrant === q).length}
								{#if n}<span class="q q{q}">Q{q}</span><span class="n">{n}</span>{/if}
							{/each}
						</div>
					</div>
				{/if}

				{#if data.tags.length}
					<div class="card">
						<h3>Tags</h3>
						<div class="counts">{#each data.tags as tag (tag)}<span class="tag">#{tag}</span>{/each}</div>
					</div>
				{/if}

				<div class="card">
					<h3>Backlinks <span class="right">{data.backlinks.length}</span></h3>
					{#each data.backlinks as link (link.path + link.line)}
						<a class="row" href={href(link.path)}>{link.title}</a>
					{:else}
						<p class="hint">No notes link here yet.</p>
					{/each}
				</div>

				{#if data.outgoing.length}
					<div class="card">
						<h3>Links out <span class="right">{data.outgoing.length}</span></h3>
						{#each data.outgoing as link (link.target)}
							<a class="row" href={href(link.path!)}>{link.target}</a>
						{/each}
					</div>
				{/if}

				<div class="card">
					<h3>Flashcards</h3>
					<p class="hint">
						Cards go into this note in the Spaced Repetition plugin's own syntax, so Obsidian sees them too.
						Nothing is written until you accept it.
					</p>
					<Draft
						label="Suggest cards"
						title="Draft flashcards from this note"
						request={{ feature: 'suggest-flashcards', path: data.path }}
						ondone={() => invalidateAll()}
					/>
				</div>
			</div>
		</aside>
	{/if}
</div>

<style>
	.layout {
		display: grid;
		grid-template-columns: var(--tree) 9px minmax(0, 1fr) 9px var(--rail);
		align-items: stretch;
		height: calc(100vh - 90px);
	}
	/* A collapsed pane becomes a thin tab and gives up its divider column. */
	.layout.tree-collapsed { grid-template-columns: 26px minmax(0, 1fr) 9px var(--rail); }
	.layout.rail-collapsed { grid-template-columns: var(--tree) 9px minmax(0, 1fr) 26px; }
	.layout.tree-collapsed.rail-collapsed { grid-template-columns: 26px minmax(0, 1fr) 26px; }

	.pane { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
	.pane-body { overflow: auto; flex: 1; min-height: 0; }
	.pane-body.stack { display: flex; flex-direction: column; gap: 12px; }
	.pane-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--muted);
		padding-bottom: 8px;
		margin-bottom: 8px;
		border-bottom: 1px solid var(--line);
	}
	.pane-head span { flex: 1; }
	.collapse {
		border: 0;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.collapse:hover { background: var(--soft); color: var(--text); }

	.rail-tab {
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--muted);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		writing-mode: vertical-rl;
		padding: 10px 4px;
	}
	.rail-tab:hover { color: var(--accent); border-color: var(--accent); }
	.rail-tab.left { margin-right: 8px; }
	.rail-tab.right { margin-left: 8px; }

	.note-pane { padding: 18px 24px; overflow: auto; min-width: 0; }
	.rail .card { font-size: 13px; }
	.crumb {
		display: flex;
		align-items: center;
		gap: 10px;
		font: 12px var(--mono);
		color: var(--muted);
		margin-bottom: 12px;
	}
	.crumb span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.crumb .btn { margin-left: auto; flex: none; font-family: inherit; }
	.row { display: block; padding: 3px 0; color: var(--accent); text-decoration: none; }
	.row:hover { text-decoration: underline; }
	.counts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
	.counts .n { margin-right: 8px; color: var(--muted); }

	/* On a phone the panes stack and the dividers are meaningless. */
	@media (max-width: 860px) {
		.layout,
		.layout.tree-collapsed,
		.layout.rail-collapsed,
		.layout.tree-collapsed.rail-collapsed {
			grid-template-columns: 1fr;
			height: auto;
			gap: 12px;
		}
		.pane, .note-pane { max-height: none; }
		/* No room for a tree beside the note, and dividers mean nothing in a
		   single column. */
		.tree, .rail-tab.left { display: none; }
		.layout :global([role='separator']) { display: none; }
		.rail-tab { writing-mode: horizontal-tb; padding: 6px 10px; }
	}
</style>

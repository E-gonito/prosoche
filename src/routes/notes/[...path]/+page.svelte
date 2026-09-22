<script lang="ts">
	/**
	 * A note: its text, the vault around it, and what points at it.
	 *
	 * Reading is the default and editing is a deliberate act — `?edit=1`, the
	 * toggle in the toolbar, or `e`. A note is something you open to read far
	 * more often than to change, and an editor that mounts on every click puts
	 * a text box under every stray keystroke.
	 *
	 * The right rail is two cards rather than six. Six headings for six short
	 * lists read as six decisions; About (what the note says about itself) and
	 * Links (what points here and where this points) are the two questions
	 * actually being asked, and the groups inside each keep their own labels.
	 *
	 * On a phone the tree has nowhere to stand beside the note, so the Files
	 * button lifts it into a bottom sheet. That is a native `<dialog>`, as
	 * everywhere else in the app, which brings Escape, the backdrop and the
	 * focus round trip without any of it being written here.
	 */
	import { goto, invalidateAll } from '$app/navigation';
	import FileTree from '$lib/components/FileTree.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import Draft from '$lib/components/Draft.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ResizeHandle from '$lib/components/ResizeHandle.svelte';
	import { Pane } from '$lib/client/pane.svelte';
	import { register } from '$lib/client/shortcuts.svelte';
	import { fitPanes } from '$lib/shared/panes';

	let { data } = $props();

	const TREE = { min: 160, max: 520 };
	const RAIL = { min: 180, max: 520 };
	const tree = new Pane('notes-tree', TREE, 230);
	const rail = new Pane('notes-rail', RAIL, 240);

	let layout: HTMLDivElement | undefined = $state();
	let available = $state(1200);
	let sheet: HTMLDialogElement | undefined = $state();
	let filesOpen = $state(false);

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

	/**
	 * `e` edits. Only while reading: in the editor the key belongs to the text,
	 * and the registry would refuse it there anyway.
	 */
	$effect(() => {
		if (data.editing) return;
		return register([
			{ keys: 'e', description: 'Edit this note', group: 'Write', run: () => goto(editHref) }
		]);
	});

	// A modal dialog has to be opened by script, and closing it by any route —
	// Escape, the backdrop, the button — comes back through `close`.
	$effect(() => {
		if (filesOpen && sheet && !sheet.open) sheet.showModal();
	});

	const widths = $derived(
		fitPanes(available, [
			{ width: tree.width, collapsed: tree.collapsed, limits: TREE },
			{ width: rail.width, collapsed: rail.collapsed, limits: RAIL }
		])
	);

	const href = (p: string) => `/notes/${p.split('/').map(encodeURIComponent).join('/')}`;
	const editHref = $derived(`${href(data.path)}?edit=1`);
	const readHref = $derived(href(data.path));
	const openCount = $derived(data.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length);
	const properties = $derived(Object.entries(data.frontmatter));
	const barren = $derived(!properties.length && !data.tasks.length && !data.tags.length);

	/**
	 * A wikilink clicked inside the editor. A link this note already resolves
	 * goes straight there; anything else goes to search, which is more useful
	 * than doing nothing when the name is a near miss.
	 */
	function navigate(target: string) {
		const match = data.outgoing.find((l) => l.target === target)?.path;
		goto(match ? href(match) : `/search?q=${encodeURIComponent(target)}`);
	}

	/**
	 * Two ways the sheet is done with: a click on the backdrop, which lands on
	 * the dialog element itself, and a note chosen from the tree, which is also
	 * a request to get the sheet out of the way.
	 */
	function dismiss(event: MouseEvent) {
		const target = event.target;
		if (target === sheet || (target instanceof HTMLElement && target.closest('a'))) sheet?.close();
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
				<button class="icon-btn collapse" onclick={() => tree.toggle()} aria-label="Hide the file tree" title="Hide">
					<Icon name="chevron-left" />
				</button>
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
			<span class="path">{data.path}</span>

			<button
				class="btn ghost files"
				onclick={() => (filesOpen = true)}
				aria-haspopup="dialog"
				data-testid="open-files"
			><Icon name="file-text" /> Files</button>

			<Draft
				label="Suggest cards"
				title="Draft flashcards from this note. They are written in the Spaced Repetition plugin's own syntax, so Obsidian sees them too, and nothing reaches the note until you accept it."
				request={{ feature: 'suggest-flashcards', path: data.path }}
				ondone={() => invalidateAll()}
			/>

			<a class="btn ghost toggle" href={data.editing ? readHref : editHref} data-testid="edit-toggle">
				<Icon name={data.editing ? 'book-open' : 'edit'} />
				{data.editing ? 'Read' : 'Edit'}
			</a>
		</div>

		{#if data.conflicted}
			<p class="problem" data-testid="conflict">
				This note has git conflict markers. Resolve it in Obsidian or on the <a href="/sync">sync page</a>.
			</p>
		{/if}

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
			aria-label="Show the note's details"
			title="Show the note's details"
		>Details</button>
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
			<!-- "Details" rather than "Links": the second card inside is called
			     Links, and the word twice over reads as a mistake. -->
			<div class="pane-head card-less">
				<span>Details</span>
				<button class="icon-btn collapse" onclick={() => rail.toggle()} aria-label="Hide the note's details" title="Hide">
					<Icon name="chevron-right" />
				</button>
			</div>
			<div class="pane-body stack">
				<div class="card" data-testid="about-card">
					<h3>About</h3>

					{#if properties.length}
						<div class="group">
							<h4>Properties</h4>
							<div class="kv">
								{#each properties as [key, value] (key)}
									<b>{key}</b><span>{Array.isArray(value) ? value.join(', ') : String(value)}</span>
								{/each}
							</div>
						</div>
					{/if}

					{#if data.tasks.length}
						<div class="group">
							<h4>Tasks <span class="right">{openCount} open of {data.tasks.length}</span></h4>
							<div class="counts">
								{#each [1, 2, 3, 4] as q (q)}
									{@const n = data.tasks.filter((t) => t.quadrant === q).length}
									{#if n}<span class="q q{q}">Q{q}</span><span class="n">{n}</span>{/if}
								{/each}
							</div>
						</div>
					{/if}

					{#if data.tags.length}
						<div class="group">
							<h4>Tags</h4>
							<div class="counts">{#each data.tags as tag (tag)}<span class="tag">#{tag}</span>{/each}</div>
						</div>
					{/if}

					{#if barren}<p class="hint">This note says nothing about itself yet.</p>{/if}
				</div>

				<div class="card" data-testid="links-card">
					<h3>Links <span class="right">{data.backlinks.length} in · {data.outgoing.length} out</span></h3>

					{#if data.backlinks.length}
						<div class="group">
							<h4>Backlinks</h4>
							{#each data.backlinks as link (link.path + link.line)}
								<a class="row" href={href(link.path)}>{link.title}</a>
							{/each}
						</div>
					{/if}

					{#if data.outgoing.length}
						<div class="group">
							<h4>Links out</h4>
							{#each data.outgoing as link (link.target)}
								<a class="row" href={href(link.path!)}>{link.target}</a>
							{/each}
						</div>
					{/if}

					{#if !data.backlinks.length && !data.outgoing.length}
						<p class="hint">No notes link here yet.</p>
					{/if}
				</div>
			</div>
		</aside>
	{/if}
</div>

{#if filesOpen}
	<dialog
		class="sheet"
		bind:this={sheet}
		onclose={() => (filesOpen = false)}
		onclick={dismiss}
		aria-label="Files"
		data-testid="files-sheet"
	>
		<div class="sheet-head">
			<span>Files</span>
			<button class="icon-btn collapse" onclick={() => sheet?.close()} aria-label="Close the file tree">
				<Icon name="x" />
			</button>
		</div>
		<div class="sheet-body"><FileTree nodes={data.tree} openPath={data.path} /></div>
	</dialog>
{/if}

<style>
	.layout {
		display: grid;
		grid-template-columns: var(--tree) 9px minmax(0, 1fr) 9px var(--rail);
		align-items: stretch;
		height: calc(100vh - var(--page-chrome));
		height: calc(100dvh - var(--page-chrome));
	}
	/* A collapsed pane becomes a thin tab and gives up its divider column. */
	.layout.tree-collapsed { grid-template-columns: 26px minmax(0, 1fr) 9px var(--rail); }
	.layout.rail-collapsed { grid-template-columns: var(--tree) 9px minmax(0, 1fr) 26px; }
	.layout.tree-collapsed.rail-collapsed { grid-template-columns: 26px minmax(0, 1fr) 26px; }

	.pane { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
	.pane-body { overflow: auto; flex: 1; min-height: 0; }
	.pane-body.stack { display: flex; flex-direction: column; gap: var(--s3); }
	.pane-head {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-size: var(--t11);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--muted);
		padding-bottom: var(--s2);
		margin-bottom: var(--s2);
		border-bottom: 1px solid var(--line);
	}
	.pane-head span { flex: 1; }
	/* An `.icon-btn`; only the size it draws its chevron at is local. */
	.collapse { font-size: var(--t14); }

	.rail-tab {
		border: 1px solid var(--line);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--muted);
		cursor: pointer;
		font: inherit;
		font-size: var(--t11);
		letter-spacing: 0.5px;
		text-transform: uppercase;
		writing-mode: vertical-rl;
		padding: 10px var(--s1);
	}
	.rail-tab:hover { color: var(--accent); border-color: var(--accent); }
	.rail-tab.left { margin-right: var(--s2); }
	.rail-tab.right { margin-left: var(--s2); }

	.note-pane { padding: 18px var(--s5); overflow: auto; min-width: 0; }
	.rail .card { font-size: var(--t13); }
	/* The rail is a couple of hundred pixels wide; the page-width key column
	   would leave no room for the value. */
	.rail .kv { grid-template-columns: minmax(0, 96px) minmax(0, 1fr); gap: 5px 10px; }

	/* A group inside a rail card: the old cards' headings, one level down. */
	.group + .group { margin-top: var(--s3); padding-top: 10px; border-top: 1px solid var(--line); }
	.group h4 {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: 0 0 6px;
		font-size: var(--t11);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--muted);
	}
	.group h4 .right { margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0; }

	/* The toolbar: where the note is, and the three things you can do to it. */
	.crumb {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 10px;
		color: var(--muted);
		margin-bottom: var(--s3);
	}
	/* Only the path is monospaced: it is a file name, and the buttons beside it
	   are the app speaking rather than the vault. */
	.crumb .path {
		flex: 1;
		min-width: 0;
		font: var(--t12) var(--mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crumb .btn { flex: none; }
	/*
	 * The drafting button belongs in this row, but its proposal does not: it is
	 * a card the width of the note. `display: contents` lifts both out of the
	 * wrapper, so the button sits between the others and anything the draft
	 * produces takes a line of its own underneath.
	 */
	.crumb :global(.draft) { display: contents; }
	.crumb :global(.draft > *:not(.go)) { flex-basis: 100%; }

	.row { display: block; padding: 3px 0; color: var(--accent); text-decoration: none; }
	.row:hover { text-decoration: underline; }
	.counts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
	.counts .n { margin-right: var(--s2); color: var(--muted); font-variant-numeric: tabular-nums; }

	/* Only offered where the tree pane itself is gone; see the media query. */
	.crumb .files { display: none; }

	/* Pinned to the floor and the full width of it: `inset: 0` comes from the
	   browser's own modal styling, so only the margins have to say "bottom". */
	.sheet {
		margin: auto 0 0;
		width: 100%;
		max-width: 100%;
		max-height: 70dvh;
		border: 0;
		border-radius: 14px 14px 0 0;
		padding: 14px var(--s4) calc(14px + env(safe-area-inset-bottom));
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		animation: rise 160ms ease-out;
	}
	.sheet::backdrop { background: rgba(31, 35, 40, 0.4); }
	.sheet-head {
		display: flex;
		align-items: center;
		gap: var(--s2);
		font-size: var(--t11);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--muted);
		padding-bottom: var(--s2);
		margin-bottom: var(--s2);
		border-bottom: 1px solid var(--line);
	}
	.sheet-head span { flex: 1; }
	.sheet-body { overflow: auto; min-height: 0; }
	@keyframes rise {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.sheet { animation: none; }
	}

	/* Too narrow for a tree beside the note: it moves into the sheet instead.
	   Wider than the usual 720px phone cutoff because this page has three
	   panes fighting for room, not two; see docs/design.md. */
	@media (max-width: 860px) {
		.layout,
		.layout.tree-collapsed,
		.layout.rail-collapsed,
		.layout.tree-collapsed.rail-collapsed {
			grid-template-columns: 1fr;
			height: auto;
			gap: var(--s3);
		}
		.pane, .note-pane { max-height: none; }
		.tree, .rail-tab.left { display: none; }
		.layout :global([role='separator']) { display: none; }
		.rail-tab { writing-mode: horizontal-tb; padding: 6px 10px; }
		.crumb .files { display: inline-flex; }
		.crumb .path { flex-basis: 100%; }
	}
</style>

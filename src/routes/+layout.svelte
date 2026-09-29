<script lang="ts">
	/**
	 * The shell: a rail of modules and the page.
	 *
	 * One list, `MODULES`, drawn twice. On a desktop it is a rail down the
	 * left with the workspaces nested under Workspaces. On a phone it is a
	 * bottom bar with the four modules marked `tab` and More, which opens a
	 * sheet with everything else, workspaces included.
	 */
	import '../app.css';
	import { page } from '$app/state';
	import SyncBadge from '$lib/components/SyncBadge.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { MODULES, SYSTEM, moduleFor } from '$lib/modules';
	import { palette } from '$lib/client/palette.svelte';
	import { keyLabel } from '$lib/client/shortcuts.svelte';

	let { children, data } = $props();
	let paletteKeys = $state('');
	let more: HTMLDialogElement | undefined = $state();

	// After mounting: the label depends on the platform, which the server
	// cannot know.
	$effect(() => {
		paletteKeys = keyLabel('mod+k');
	});

	// Any navigation closes the More sheet, whichever link was followed.
	$effect(() => {
		void page.url.pathname;
		more?.close();
	});

	const current = $derived(moduleFor(page.url.pathname));
	const workspace = $derived(page.url.pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null);
	const tabs = MODULES.filter((m) => m.tab);
</script>

<div class="shell">
	<nav class="rail" aria-label="Modules">
		<a class="brand" href="/today">prosoche</a>

		<button class="jump" onclick={() => palette.show()} data-testid="jump">
			<Icon name="search" />
			<span>Search or jump</span>
			{#if paletteKeys}<kbd>{paletteKeys}</kbd>{/if}
		</button>

		<div class="modules">
			{#each MODULES as m (m.id)}
				<a href={m.href} aria-current={current?.id === m.id && !(m.id === 'w' && workspace) ? 'page' : undefined}>
					<Icon name={m.icon} /><span>{m.title}</span>
				</a>
				{#if m.id === 'w'}
					<div class="spaces">
						{#each data.workspaces as w (w.slug)}
							<a href="/w/{w.slug}" aria-current={workspace === w.slug ? 'page' : undefined}>
								<i style="--dot: {w.color}"></i><span>{w.name}</span>
							</a>
						{/each}
					</div>
				{/if}
			{/each}
		</div>

		<div class="foot">
			{#each SYSTEM as m (m.id)}
				<a href={m.href} aria-current={current?.id === m.id ? 'page' : undefined}>
					<Icon name={m.icon} /><span>{m.title}</span>
				</a>
			{/each}
			<SyncBadge />
		</div>
	</nav>

	<header class="top">
		<a class="brand" href="/today">prosoche</a>
		<button class="icon-btn" onclick={() => palette.show()} aria-label="Search or jump"><Icon name="search" size={20} /></button>
		<SyncBadge />
	</header>

	<main>{@render children()}</main>

	<nav class="tabbar" aria-label="Modules" data-testid="tabbar">
		{#each tabs as m (m.id)}
			<a href={m.href} aria-current={current?.id === m.id ? 'page' : undefined}>
				<Icon name={m.icon} size={22} /><span>{m.title}</span>
			</a>
		{/each}
		<button onclick={() => more?.showModal()} data-testid="tab-more">
			<Icon name="more-horizontal" size={22} /><span>More</span>
		</button>
	</nav>

	<dialog class="more" bind:this={more} onclick={(e) => e.target === more && more?.close()}>
		<div class="sheet-body">
			<p class="label">Modules</p>
			<div class="grid">
				{#each MODULES as m (m.id)}
					<a href={m.href}><Icon name={m.icon} size={20} /><span>{m.title}</span></a>
				{/each}
			</div>
			{#if data.workspaces.length}
				<p class="label">Workspaces</p>
				<div class="list">
					{#each data.workspaces as w (w.slug)}
						<a href="/w/{w.slug}"><i style="--dot: {w.color}"></i>{w.name}</a>
					{/each}
				</div>
			{/if}
			<p class="label">System</p>
			<div class="list">
				{#each SYSTEM as m (m.id)}
					<a href={m.href}><Icon name={m.icon} />{m.title}</a>
				{/each}
			</div>
		</div>
	</dialog>

	<Palette />
</div>

<style>
	.shell { display: grid; grid-template-columns: var(--rail-w) 1fr; min-height: 100vh; }

	.rail {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s5) var(--s3) var(--s4);
		border-right: 1px solid var(--line);
		overflow-y: auto;
	}
	.brand {
		font: 600 22px/1 var(--serif);
		color: var(--text);
		letter-spacing: -0.02em;
		padding: 0 var(--s2) var(--s3);
	}
	.brand:hover { text-decoration: none; }

	.jump {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin-bottom: var(--s3);
		padding: 7px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
		color: var(--muted);
		font: inherit;
		font-size: var(--t13);
		cursor: pointer;
	}
	.jump:hover { color: var(--text); border-color: var(--accent); }
	.jump span { flex: 1; text-align: left; }
	.jump kbd { font: var(--t11) var(--mono); border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }

	.rail a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		border-radius: var(--r-md);
		color: var(--text);
		font-size: var(--t14);
	}
	.rail a:hover { background: var(--soft); text-decoration: none; }
	.rail a[aria-current='page'] { background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); font-weight: 600; }
	.rail a :global(svg) { color: var(--muted); flex: none; }
	.rail a[aria-current='page'] :global(svg) { color: var(--accent); }

	.modules { display: flex; flex-direction: column; gap: 2px; }
	.spaces { display: flex; flex-direction: column; gap: 1px; margin: 0 0 var(--s1) 18px; padding-left: var(--s2); border-left: 1px solid var(--line); }
	.spaces a { font-size: var(--t13); padding: 5px 10px; }
	.spaces span, .modules span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }

	.foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: var(--s3); border-top: 1px solid var(--line); }
	.foot :global(.sync) { align-self: flex-start; margin: var(--s2) 10px 0; }

	main { min-width: 0; }

	.top, .tabbar { display: none; }

	dialog.more {
		margin: auto auto 0;
		width: 100%;
		max-width: 520px;
		border: 0;
		border-radius: 16px 16px 0 0;
		padding: 0;
		background: var(--panel);
		box-shadow: var(--shadow-lg);
	}
	dialog.more::backdrop { background: rgba(42, 38, 34, 0.35); }
	.sheet-body { padding: var(--s5) var(--s5) calc(var(--s5) + env(safe-area-inset-bottom)); }
	.sheet-body .label:first-child { margin-top: 0; }
	.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s2); }
	.grid a {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: var(--s3) var(--s2);
		border-radius: var(--r-md);
		background: var(--bg);
		color: var(--text);
		font-size: var(--t13);
	}
	.list { display: flex; flex-direction: column; }
	.list a { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--text); border-bottom: 1px solid var(--line); }

	@media (max-width: 720px) {
		/* Two rows, header and page; the bar is fixed and out of the flow. */
		.shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
		.rail { display: none; }

		.top {
			display: flex;
			align-items: center;
			gap: var(--s2);
			position: sticky;
			top: 0;
			z-index: 30;
			height: var(--header-h);
			padding: 0 var(--s4);
			padding-top: env(safe-area-inset-top);
			background: color-mix(in srgb, var(--bg) 92%, transparent);
			backdrop-filter: blur(8px);
			border-bottom: 1px solid var(--line);
		}
		.top .brand { padding: 0; font-size: 20px; margin-right: auto; }

		.tabbar {
			position: fixed;
			inset: auto 0 0 0;
			z-index: 40;
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: 1fr;
			height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
			padding-bottom: env(safe-area-inset-bottom);
			background: var(--panel);
			border-top: 1px solid var(--line);
		}
		.tabbar a,
		.tabbar button {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			/* The smallest target a thumb reliably hits. */
			min-height: 44px;
			border: 0;
			background: none;
			font: inherit;
			color: var(--muted);
			cursor: pointer;
		}
		.tabbar a:hover { text-decoration: none; }
		.tabbar span { font-size: var(--t11); line-height: 1; }
		.tabbar [aria-current='page'] { color: var(--accent); font-weight: 600; }
	}
</style>

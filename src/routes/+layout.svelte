<script lang="ts">
	/**
	 * The shell: a rail of modules and the page.
	 *
	 * One list, `MODULES`, drawn twice. On a desktop it is a rail down the
	 * left, with each module's sub-items from the loader nested under it: the
	 * workspaces under Workspaces, the glossaries under Glossary. On a phone
	 * it is a bar under the header, pinned to the top with it, holding the
	 * four modules marked `tab` and More, which opens a sheet with everything
	 * else, workspaces included.
	 */
	import '../app.css';
	import { page } from '$app/state';
	import SyncBadge from '$lib/components/SyncBadge.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { MODULES, SYSTEM, moduleFor, subItemFor } from '$lib/modules';
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
				{@const subs = data.sub[m.id] ?? []}
				{@const on = subItemFor(subs, page.url.pathname)}
				<!-- A module is the current page only when none of its sub-items is. -->
				<a href={m.href} aria-current={current?.id === m.id && !on ? 'page' : undefined}>
					<Icon name={m.icon} /><span>{m.title}</span>
				</a>
				{#if subs.length}
					<div class="subs" data-testid="sub-{m.id}">
						{#each subs as item (item.href)}
							<a href={item.href} aria-current={on === item ? 'page' : undefined}>
								<i style="--dot: {item.color}"></i><span>{item.title}</span>
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
		<div class="bar">
			<a class="brand" href="/today">prosoche</a>
			<button class="icon-btn" onclick={() => palette.show()} aria-label="Search or jump"><Icon name="search" size={20} /></button>
			<SyncBadge />
		</div>
		<nav class="tabbar" aria-label="Modules" data-testid="tabbar">
			{#each tabs as m (m.id)}
				<a href={m.href} aria-current={current?.id === m.id ? 'page' : undefined}>
					<Icon name={m.icon} size={20} /><span>{m.title}</span>
				</a>
			{/each}
			<button onclick={() => more?.showModal()} data-testid="tab-more">
				<Icon name="more-horizontal" size={20} /><span>More</span>
			</button>
		</nav>
	</header>

	<main>{@render children()}</main>

	<dialog class="more" bind:this={more} onclick={(e) => e.target === more && more?.close()}>
		<div class="sheet-body">
			<p class="label">Modules</p>
			<div class="grid">
				{#each MODULES as m (m.id)}
					<a href={m.href}><Icon name={m.icon} size={20} /><span>{m.title}</span></a>
				{/each}
			</div>
			{#if data.sub.w?.length}
				<p class="label">Workspaces</p>
				<div class="list">
					{#each data.sub.w as item (item.href)}
						<a href={item.href}><i style="--dot: {item.color}"></i>{item.title}</a>
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
	.subs { display: flex; flex-direction: column; gap: 1px; margin: 0 0 var(--s1) 18px; padding-left: var(--s2); border-left: 1px solid var(--line); }
	.subs a { font-size: var(--t13); padding: 5px 10px; }
	.subs span, .modules span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }

	.foot { margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding-top: var(--s3); border-top: 1px solid var(--line); }
	.foot :global(.sync) { align-self: flex-start; margin: var(--s2) 10px 0; }

	main { min-width: 0; }

	.top { display: none; }

	/* A sheet that drops from the top, under the bar that opened it. */
	dialog.more {
		margin: 0 auto auto;
		width: 100%;
		max-width: 520px;
		max-height: 100%;
		border: 0;
		border-radius: 0 0 16px 16px;
		padding: 0;
		background: var(--panel);
		box-shadow: var(--shadow-lg);
	}
	dialog.more::backdrop { background: rgba(42, 38, 34, 0.35); }
	.sheet-body { padding: calc(var(--s5) + env(safe-area-inset-top)) var(--s5) var(--s5); }
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
		/* Two rows, header and page; the header carries the modules bar. */
		.shell { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
		.rail { display: none; }

		.top {
			display: block;
			position: sticky;
			top: 0;
			z-index: 30;
			padding-top: env(safe-area-inset-top);
			background: color-mix(in srgb, var(--bg) 92%, transparent);
			backdrop-filter: blur(8px);
			border-bottom: 1px solid var(--line);
		}
		.bar {
			display: flex;
			align-items: center;
			gap: var(--s2);
			height: var(--header-h);
			padding: 0 var(--s4);
		}
		.bar .brand { padding: 0; font-size: 20px; margin-right: auto; }

		.tabbar {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: 1fr;
			height: var(--tabbar-h);
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
			/* The current tab is underlined, flush with the header's own line. */
			border-bottom: 2px solid transparent;
			margin-bottom: -1px;
			background: none;
			font: inherit;
			color: var(--muted);
			cursor: pointer;
		}
		.tabbar a:hover { text-decoration: none; }
		.tabbar span { font-size: var(--t11); line-height: 1; }
		.tabbar [aria-current='page'] { color: var(--accent); font-weight: 600; border-bottom-color: var(--accent); }
	}
</style>

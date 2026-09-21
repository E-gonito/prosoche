<script lang="ts">
	/**
	 * The shell: a header, a way to get anywhere, and the page.
	 *
	 * There are two navigations and one list behind them. On a desktop the
	 * sidebar shows every destination and collapses to a rail of icons; on a
	 * phone the sidebar goes away entirely and a bottom bar takes four of them
	 * plus "More", which opens the palette. A rail of unlabelled icons down the
	 * side of a phone cost width and hit nothing reliably, which is why it is
	 * gone rather than narrowed.
	 */
	import '../app.css';
	import { page } from '$app/state';
	import SyncBadge from '$lib/components/SyncBadge.svelte';
	import Timer from '$lib/components/Timer.svelte';
	import Palette from '$lib/components/Palette.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { NAV, SETTINGS, TABS } from '$lib/client/nav';
	import { palette } from '$lib/client/palette.svelte';
	import { keyLabel } from '$lib/client/shortcuts.svelte';

	let { children, data } = $props();
	let collapsed = $state(false);
	// Read after mounting: the label depends on the platform, which the server
	// cannot know, and a guess would render ⌘ for half the world.
	let paletteKeys = $state('');

	// Remembered per device, as agreed in the mockup review.
	$effect(() => {
		collapsed = localStorage.getItem('hub:nav-collapsed') === '1';
	});
	$effect(() => {
		paletteKeys = keyLabel('mod+k');
	});
	function toggle() {
		collapsed = !collapsed;
		localStorage.setItem('hub:nav-collapsed', collapsed ? '1' : '0');
	}

	/**
	 * Today covers the day pages too: the root redirects to a dated URL, so
	 * matching the href alone would leave the app with nothing highlighted for
	 * the page it opens on.
	 */
	const active = (href: string) =>
		href === '/' ? page.url.pathname === '/' || page.url.pathname.startsWith('/day/') : page.url.pathname.startsWith(href);
</script>

<div class="shell" class:collapsed>
	<header>
		<button
			class="btn ghost collapse"
			onclick={toggle}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={!collapsed}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		><Icon name="menu" /></button>
		<span class="brand">prosoche</span>

		<button class="jump" onclick={() => palette.show()} title="Search or jump to…" data-testid="jump">
			<Icon name="search" />
			<span class="say">Search or jump to…</span>
			{#if paletteKeys}<kbd>{paletteKeys}</kbd>{/if}
		</button>

		<Timer />
		<SyncBadge />
	</header>

	<nav class="sidebar" aria-label="Sections">
		<div class="group">
			{#each NAV as item (item.href)}
				<a href={item.href} class:active={active(item.href)} title={collapsed ? item.label : undefined}>
					<span class="ic"><Icon name={item.icon} /></span><span class="lb">{item.label}</span>
				</a>
			{/each}
			<h6>Workspaces</h6>
			{#each data.workspaces as w (w.slug)}
				<a href="/w/{w.slug}" class:active={page.url.pathname.startsWith(`/w/${w.slug}`)} title={w.name}>
					<span class="ic dot" style="--dot: {w.color}"></span><span class="lb">{w.name}</span>
					{#if w.urgent}<span class="count" title="{w.urgent} urgent">{w.urgent}</span>{/if}
				</a>
			{/each}
			<a href="/w/new" class="new" class:active={page.url.pathname === '/w/new'} title={collapsed ? 'New workspace' : undefined}>
				<span class="ic"><Icon name="plus" /></span><span class="lb">New workspace</span>
			</a>
		</div>

		<div class="group bottom">
			<a href={SETTINGS.href} class:active={page.url.pathname.startsWith('/settings')} title={collapsed ? SETTINGS.label : undefined}>
				<span class="ic"><Icon name={SETTINGS.icon} /></span><span class="lb">{SETTINGS.label}</span>
			</a>
		</div>
	</nav>

	<main>{@render children()}</main>

	<nav class="tabbar" aria-label="Sections" data-testid="tabbar">
		{#each TABS as tab (tab.label)}
			{#if tab.href === null}
				<button onclick={() => palette.show()} data-testid="tab-more">
					<Icon name={tab.icon} size={20} />
					<span>{tab.label}</span>
				</button>
			{:else}
				<a href={tab.href} aria-current={active(tab.href) ? 'page' : undefined}>
					<Icon name={tab.icon} size={20} />
					<span>{tab.label}</span>
				</a>
			{/if}
		{/each}
	</nav>

	<Palette />
</div>

<style>
	.shell {
		/* The phone's bottom bar, named here because `main` reserves room for
		   it and the bar itself is the thing that is that tall. */
		--tabbar: 56px;
		display: grid;
		grid-template-columns: 220px 1fr;
		grid-template-rows: 48px 1fr;
		height: 100vh;
	}
	.shell.collapsed { grid-template-columns: 56px 1fr; }

	header {
		grid-column: 1 / 3;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 12px;
		background: var(--panel);
		border-bottom: 1px solid var(--line);
	}
	.brand { font-weight: 700; letter-spacing: 0.2px; }

	/* The palette's doorway for people who do not know the chord exists. */
	.jump {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		width: 260px;
		padding: 5px 10px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--bg);
		color: var(--muted);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.jump:hover { background: var(--soft); border-color: var(--accent); color: var(--text); }
	.jump .say { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.jump kbd {
		flex: none;
		font: 11px var(--mono);
		color: var(--muted);
		border: 1px solid var(--line);
		border-bottom-width: 2px;
		border-radius: 5px;
		padding: 0 5px;
	}

	nav.sidebar {
		background: var(--panel);
		border-right: 1px solid var(--line);
		padding: 12px 10px;
		overflow: auto;
		display: flex;
		flex-direction: column;
	}
	.collapsed nav.sidebar { padding: 12px 6px; }
	/* Settings sits against the floor, away from the day-to-day list. */
	.group.bottom { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); }
	nav.sidebar a {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 8px;
		color: var(--text);
		text-decoration: none;
	}
	nav.sidebar .new { color: var(--muted); font-size: 13px; }
	.dot::before {
		content: '';
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--dot);
	}
	.count {
		margin-left: auto;
		font: 11px var(--mono);
		color: var(--muted);
		background: var(--soft);
		border-radius: 999px;
		padding: 1px 6px;
	}
	.collapsed nav.sidebar .count { display: none; }
	nav.sidebar a:hover { background: var(--soft); }
	nav.sidebar a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
	nav.sidebar h6 {
		margin: 14px 8px 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	.ic { display: inline-flex; width: 16px; justify-content: center; }
	.collapsed nav.sidebar a { justify-content: center; padding: 8px 0; }
	.collapsed nav.sidebar .lb,
	.collapsed nav.sidebar h6 { display: none; }

	main { overflow: auto; padding: 20px 24px; }

	/* The bottom bar exists on a phone only; see the media query below. */
	nav.tabbar { display: none; }

	@media (max-width: 720px) {
		/* One column: there is no room beside the page for anything. */
		.shell,
		.shell.collapsed { grid-template-columns: 1fr; grid-template-rows: 48px 1fr; }
		header { grid-column: 1; }
		nav.sidebar { display: none; }
		.collapse { display: none; }
		.jump { width: auto; padding: 6px; border-radius: 10px; margin-left: auto; }
		.jump .say, .jump kbd { display: none; }

		main { padding: 14px; padding-bottom: calc(var(--tabbar) + env(safe-area-inset-bottom)); }

		nav.tabbar {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 40;
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: 1fr;
			background: var(--panel);
			border-top: 1px solid var(--line);
			/* Exactly as tall as `main` reserves, border and safe area included. */
			height: calc(var(--tabbar) + env(safe-area-inset-bottom));
			padding-bottom: env(safe-area-inset-bottom);
		}
		nav.tabbar a,
		nav.tabbar button {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			min-height: 44px;
			height: 100%;
			padding: 0 2px;
			border: 0;
			background: none;
			font: inherit;
			color: var(--muted);
			text-decoration: none;
			cursor: pointer;
		}
		nav.tabbar span { font-size: 11px; line-height: 1; }
		nav.tabbar [aria-current='page'] { color: var(--accent); font-weight: 600; }
	}
</style>

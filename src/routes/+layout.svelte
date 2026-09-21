<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import SyncBadge from '$lib/components/SyncBadge.svelte';
	import Timer from '$lib/components/Timer.svelte';
	import Palette from '$lib/components/Palette.svelte';

	let { children, data } = $props();
	let collapsed = $state(false);

	// Remembered per device, as agreed in the mockup review.
	$effect(() => {
		collapsed = localStorage.getItem('hub:nav-collapsed') === '1';
	});
	function toggle() {
		collapsed = !collapsed;
		localStorage.setItem('hub:nav-collapsed', collapsed ? '1' : '0');
	}

	const nav = [
		{ href: '/', icon: '🗓', label: 'Today' },
		{ href: '/notes', icon: '📝', label: 'Notes' },
		{ href: '/study', icon: '🎓', label: 'Study' },
		{ href: '/ask', icon: '✦', label: 'Ask' },
		{ href: '/search', icon: '🔍', label: 'Search' },
		{ href: '/review', icon: '☑', label: 'Review' },
		{ href: '/sync', icon: '⇅', label: 'Sync' }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));
</script>

<div class="shell" class:collapsed>
	<header>
		<button
			class="btn ghost"
			onclick={toggle}
			aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
			aria-expanded={!collapsed}
			title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
		>☰</button>
		<span class="brand">Hub</span>
		<Timer />
		<SyncBadge />
	</header>

	<nav>
		{#each nav as item (item.href)}
			<a href={item.href} class:active={active(item.href)}>
				<span class="ic">{item.icon}</span><span class="lb">{item.label}</span>
			</a>
		{/each}
		<h6>Workspaces</h6>
		{#each data.workspaces as w (w.slug)}
			<a href="/w/{w.slug}" class:active={page.url.pathname.startsWith(`/w/${w.slug}`)} title={w.name}>
				<span class="ic dot" style="--dot: {w.color}"></span><span class="lb">{w.name}</span>
				{#if w.urgent}<span class="count" title="{w.urgent} urgent">{w.urgent}</span>{/if}
			</a>
		{/each}
		<a href="/w/new" class="new" class:active={page.url.pathname === '/w/new'}>
			<span class="ic">＋</span><span class="lb">New workspace</span>
		</a>
	</nav>

	<main>{@render children()}</main>
	<Palette />
</div>

<style>
	.shell {
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

	nav {
		background: var(--panel);
		border-right: 1px solid var(--line);
		padding: 12px 10px;
		overflow: auto;
	}
	.collapsed nav { padding: 12px 6px; }
	nav a {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: 8px;
		color: var(--text);
		text-decoration: none;
	}
	nav .new { color: var(--muted); font-size: 13px; }
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
	.collapsed nav .count { display: none; }
	nav a:hover { background: var(--soft); }
	nav a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
	nav h6 {
		margin: 14px 8px 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: var(--muted);
	}
	.ic { display: inline-flex; width: 16px; justify-content: center; }
	.collapsed nav a { justify-content: center; padding: 8px 0; }
	.collapsed nav :global(.lb),
	.collapsed nav h6 { display: none; }

	main { overflow: auto; padding: 20px 24px; }

	@media (max-width: 720px) {
		.shell { grid-template-columns: 56px 1fr; }
		.shell :global(.lb) { display: none; }
		main { padding: 14px; }
	}
</style>

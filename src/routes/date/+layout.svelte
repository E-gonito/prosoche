<script lang="ts">
	/**
	 * The Dating shell: a page column and the four tabs the artifact's own
	 * bottom nav names (Log, Stats, History, Data — ours is People, since
	 * that is what the tab actually holds).
	 *
	 * Private end to end: nothing here calls the index or search, and every
	 * page under this layout reads and writes through `$server/dating`, the
	 * one module allowed to ask the vault for private scope.
	 */
	import { page } from '$app/state';

	let { children } = $props();

	const TABS = [
		{ href: '/date', title: 'Log' },
		{ href: '/date/stats', title: 'Stats' },
		{ href: '/date/history', title: 'History' },
		{ href: '/date/people', title: 'People' }
	];

	const active = $derived(
		[...TABS].reverse().find((t) => page.url.pathname === t.href || page.url.pathname.startsWith(`${t.href}/`))
			?.href ?? '/date'
	);
</script>

<div class="page">
	<div class="title">
		<h1>Date</h1>
		<p>Private to this box: never in search, Today or Notes.</p>
	</div>

	<nav class="tabs" aria-label="Date" data-testid="dating-tabs">
		{#each TABS as t (t.href)}
			<a href={t.href} aria-current={active === t.href ? 'page' : undefined}>{t.title}</a>
		{/each}
	</nav>

	{@render children()}
</div>

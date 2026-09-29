<script lang="ts">
	/**
	 * The row of tabs every `/study/*` page shares. Overview is always there;
	 * every other tab hides until its own note has something in it, which is
	 * why the list comes from the page's own load rather than being fixed here.
	 */
	import { page } from '$app/state';
	import type { StudyTab } from '$lib/shared/study';

	let { tabs }: { tabs: StudyTab[] } = $props();
	const shown = $derived(tabs.filter((t) => t.visible));
</script>

<nav class="tabs" data-testid="study-tabs" aria-label="Study">
	{#each shown as tab (tab.href)}
		<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.title}</a>
	{/each}
</nav>

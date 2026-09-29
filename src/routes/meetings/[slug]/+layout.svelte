<script lang="ts">
	/**
	 * A workspace's meeting notebook: the card, the notes, the glossary, and
	 * one tab per custom page, as in the primer artifact it grew from.
	 */
	import { page } from '$app/state';

	let { data, children } = $props();

	const base = $derived(`/meetings/${data.workspace.slug}`);
	const tabs = $derived([
		{ href: base, label: 'Meeting card' },
		{ href: `${base}/notes`, label: 'Notes' },
		{ href: `${base}/glossary`, label: 'Glossary' }
	]);
</script>

<div class="page">
	<div class="title">
		<a class="crumb" href="/meetings">Meetings</a>
		<h1><i style="--dot: {data.workspace.color}"></i>{data.workspace.name}</h1>
		<p>Read the card before you go in · capture what you don't know while you're there</p>
	</div>

	<nav class="tabs" aria-label="Notebook">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>{tab.label}</a>
		{/each}
		{#each data.pages as custom (custom.href)}
			<a href={custom.href}>{custom.title}</a>
		{/each}
	</nav>

	{#if data.home}
		{@render children()}
	{:else}
		<p class="callout">
			<b>No folder.</b> This workspace has no folder, so there is nowhere to keep a primer, meeting notes or a
			glossary. Add one to <code>folders</code> in its workspace file.
		</p>
	{/if}
</div>

<style>
	h1 { display: flex; align-items: center; gap: 10px; }
	i { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--dot); }
	code { font: var(--t13) var(--mono); }
</style>

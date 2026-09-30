<script lang="ts">
	/**
	 * The heading every page about one thing shares — a workspace, a study
	 * subject, a glossary: the crumb, the coloured name, the description (or
	 * `fallback` when there is none) and a meta line. It only shows them;
	 * editing and deleting live on the module's list page (`EditDetails`).
	 */
	import type { Snippet } from 'svelte';

	let {
		details,
		crumb,
		fallback = '',
		meta
	}: {
		details: { name: string; description: string; color?: string };
		crumb?: { href: string; label: string };
		/** Shown in the description's place when there is none. */
		fallback?: string;
		/** The line under the description: a tag, a count. */
		meta?: Snippet;
	} = $props();
</script>

<div class="title">
	{#if crumb}<a class="crumb" href={crumb.href}>{crumb.label}</a>{/if}
	<h1>{#if details.color}<span class="dot lg" style="--dot: {details.color}"></span>{/if}{details.name}</h1>
	{#if details.description || fallback}<p data-testid="details-description">{details.description || fallback}</p>{/if}
	{#if meta}<p class="line">{@render meta()}</p>{/if}
</div>

<style>
	h1 { display: flex; align-items: center; gap: var(--s2); }
	.line { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
</style>

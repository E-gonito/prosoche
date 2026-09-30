<script lang="ts">
	/**
	 * A subject's heading and the row of tabs every `/study/<subject>/*` page
	 * shares. Every tab always shows: a new subject should invite filling in,
	 * and each tab is where its own first entry is written.
	 *
	 * The heading is the shared `DetailsHeader`; the subject is edited and
	 * deleted from the Study list. The page's `lede` stands in for a subject
	 * with no description.
	 */
	import { page } from '$app/state';
	import DetailsHeader from '$lib/components/DetailsHeader.svelte';
	import { STUDY_TABS, type SubjectRef } from '$lib/shared/study';

	let { subject, lede = '' }: { subject: SubjectRef; lede?: string } = $props();
	const base = $derived(`/study/${subject.slug}`);
	/** From the subject layout's load, which every page using this sits under. */
	const details = $derived(page.data.details as { name: string; description: string; color: string });
</script>

<DetailsHeader crumb={{ href: '/study', label: 'Study' }} {details} fallback={lede} />

<nav class="tabs" data-testid="study-tabs" aria-label="{subject.name} tabs">
	{#each STUDY_TABS as tab (tab.path)}
		<a href="{base}{tab.path}" aria-current={page.url.pathname === `${base}${tab.path}` ? 'page' : undefined}>{tab.title}</a>
	{/each}
</nav>

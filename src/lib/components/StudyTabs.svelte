<script lang="ts">
	/**
	 * A subject's heading and the row of tabs every `/study/<subject>/*` page
	 * shares. Every tab always shows: a new subject should invite filling in,
	 * and each tab is where its own first entry is written.
	 */
	import { page } from '$app/state';
	import { STUDY_TABS, type SubjectRef } from '$lib/shared/study';

	let { subject, lede = '' }: { subject: SubjectRef; lede?: string } = $props();
	const base = $derived(`/study/${subject.slug}`);
</script>

<div class="title">
	<a class="crumb" href="/study">Study</a>
	<h1>{subject.name}</h1>
	{#if lede}<p>{lede}</p>{/if}
</div>

<nav class="tabs" data-testid="study-tabs" aria-label="{subject.name} tabs">
	{#each STUDY_TABS as tab (tab.path)}
		<a href="{base}{tab.path}" aria-current={page.url.pathname === `${base}${tab.path}` ? 'page' : undefined}>{tab.title}</a>
	{/each}
</nav>

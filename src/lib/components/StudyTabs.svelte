<script lang="ts">
	/**
	 * A subject's heading and the row of tabs every `/study/<subject>/*` page
	 * shares. Every tab always shows: a new subject should invite filling in,
	 * and each tab is where its own first entry is written.
	 *
	 * The heading is the shared `DetailsHeader`, whose Edit writes the
	 * subject's own file in `_hub/subjects/` and whose Delete removes it. The
	 * page's `lede` stands in for a subject with no description.
	 */
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import DetailsHeader, { type Details } from '$lib/components/DetailsHeader.svelte';
	import { api, saveSubject } from '$lib/client/api';
	import { STUDY_TABS, type SubjectRef } from '$lib/shared/study';

	let { subject, lede = '' }: { subject: SubjectRef; lede?: string } = $props();
	const base = $derived(`/study/${subject.slug}`);
	/** From the subject layout's load, which every page using this sits under. */
	const details = $derived(page.data.details as Details);
	let confirming = $state(false);
	let problem = $state('');

	/**
	 * Remove the subject's file, once asked twice. Its goals, reading,
	 * sessions and notes are never touched.
	 */
	async function remove() {
		problem = '';
		const result = await api('/api/study/subject', { subject: subject.slug }, { method: 'DELETE' });
		if (result.ok) await goto('/study', { invalidateAll: true });
		else problem = result.message;
	}
</script>

{#key subject.slug}
	<DetailsHeader
		crumb={{ href: '/study', label: 'Study' }}
		{details}
		fields={['name', 'description', 'color', 'tag']}
		fallback={lede}
		fileHref={page.data.definitionHref}
		save={async (changed) => {
			const result = await saveSubject(subject.slug, changed);
			if (result.ok) await invalidateAll();
			return result;
		}}
	>
		{#snippet actions()}
			{#if confirming}
				<span class="ask" data-testid="delete-subject-ask">
					Delete this subject? Only its file goes; <code>{subject.home}</code> stays.
					<button class="btn ghost small remove" onclick={remove} data-testid="delete-subject-confirm">Delete</button>
					<button class="btn ghost small" onclick={() => (confirming = false)}>Keep</button>
				</span>
			{:else}
				<button class="link-btn remove" onclick={() => (confirming = true)} data-testid="delete-subject">Delete</button>
			{/if}
		{/snippet}
	</DetailsHeader>
{/key}
{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

<nav class="tabs" data-testid="study-tabs" aria-label="{subject.name} tabs">
	{#each STUDY_TABS as tab (tab.path)}
		<a href="{base}{tab.path}" aria-current={page.url.pathname === `${base}${tab.path}` ? 'page' : undefined}>{tab.title}</a>
	{/each}
</nav>

<style>
	.remove { color: var(--bad); }
	.ask { font-size: var(--t13); display: inline-flex; align-items: center; gap: var(--s1); flex-wrap: wrap; }
</style>

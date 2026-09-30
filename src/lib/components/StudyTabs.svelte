<script lang="ts">
	/**
	 * A subject's heading and the row of tabs every `/study/<subject>/*` page
	 * shares. Every tab always shows: a new subject should invite filling in,
	 * and each tab is where its own first entry is written.
	 *
	 * The heading is the shared `DetailsHeader`: a subject is a workspace, so
	 * its Edit writes the same file the workspace's does. Its kind is not
	 * offered here, since a subject changed to a project would have no Study
	 * page to come back to. The page's `lede` stands in for a subject with no
	 * description.
	 */
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import DetailsHeader, { type Details } from '$lib/components/DetailsHeader.svelte';
	import { saveWorkspace } from '$lib/client/api';
	import { STUDY_TABS, type SubjectRef } from '$lib/shared/study';

	let { subject, lede = '' }: { subject: SubjectRef; lede?: string } = $props();
	const base = $derived(`/study/${subject.slug}`);
	/** From the subject layout's load, which every page using this sits under. */
	const details = $derived(page.data.details as Details);
</script>

{#key subject.slug}
	<DetailsHeader
		crumb={{ href: '/study', label: 'Study' }}
		{details}
		fields={['name', 'description', 'color', 'tag']}
		fallback={lede}
		fileHref={page.data.definitionHref}
		save={async (changed) => {
			const result = await saveWorkspace(subject.slug, changed);
			if (result.ok) await invalidateAll();
			return result;
		}}
	/>
{/key}

<nav class="tabs" data-testid="study-tabs" aria-label="{subject.name} tabs">
	{#each STUDY_TABS as tab (tab.path)}
		<a href="{base}{tab.path}" aria-current={page.url.pathname === `${base}${tab.path}` ? 'page' : undefined}>{tab.title}</a>
	{/each}
</nav>

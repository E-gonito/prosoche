<script lang="ts">
	/** The reading list: what to read next, what is under way, what is done. */
	import StudyTabs from '$lib/components/StudyTabs.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { setResourceStatus, type Resource, type ResourceStatus } from '$lib/client/study';
	import { noteHref } from '$lib/shared/links';

	let { data } = $props();

	const GROUPS: Array<{ status: ResourceStatus; label: string }> = [
		{ status: 'learning', label: 'Reading' },
		{ status: 'queued', label: 'To read' },
		{ status: 'paused', label: 'Paused' },
		{ status: 'done', label: 'Done' }
	];

	let patches = $state(new Map<string, Resource>());
	const resourcesOf = (status: ResourceStatus) =>
		data.resources.map((r) => patches.get(r.path) ?? r).filter((r) => r.status === status);

	let problem = $state('');

	async function move(resource: Resource, status: ResourceStatus) {
		problem = '';
		const result = await setResourceStatus(resource.path, status);
		if (result.ok) {
			const next = new Map(patches);
			next.set(resource.path, result.value);
			patches = next;
		} else {
			problem = result.message;
		}
	}
</script>

<svelte:head><title>Reading list · Study · prosoche</title></svelte:head>

<div class="page">
	<div class="title">
		<h1>Study</h1>
		<p>What to read or watch next, and what is already under way.</p>
	</div>

	<StudyTabs tabs={data.tabs} />

	{#if problem}<p class="problem">{problem}</p>{/if}

	{#if data.resources.length === 0}
		<p class="none">No resources found yet.</p>
	{/if}

	{#each GROUPS as group (group.status)}
		{@const items = resourcesOf(group.status)}
		{#if items.length > 0}
			<p class="label">{group.label}<span class="right num">{items.length}</span></p>
			<div class="sheet rows" data-testid="resource-group-{group.status}">
				{#each items as resource (resource.path)}
					<div class="resource" data-testid="resource">
						<div class="main">
							<a class="title" href={noteHref(resource.path)}>{resource.title}</a>
							<span class="meta muted small">
								{resource.kind}
								{#if resource.url}<a href={resource.url} target="_blank" rel="noreferrer" class="ext"><Icon name="external-link" size={12} label="Open link" /></a>{/if}
							</span>
						</div>
						{#if resource.progress > 0 && resource.status !== 'done'}
							<div class="bar" title="{resource.progress}%"><i style="width: {resource.progress}%"></i></div>
						{/if}
						<select
							class="field status"
							aria-label="Status of {resource.title}"
							value={resource.status}
							onchange={(e) => move(resource, e.currentTarget.value as ResourceStatus)}
						>
							{#each GROUPS as g (g.status)}
								<option value={g.status}>{g.label}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>
		{/if}
	{/each}
</div>

<style>
	.resource { display: flex; align-items: center; gap: var(--s3); }
	.main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.title { color: var(--text); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.title:hover { color: var(--accent); }
	.meta { display: flex; align-items: center; gap: 6px; text-transform: capitalize; }
	.ext { display: inline-flex; color: var(--muted); }
	.ext:hover { color: var(--accent); }

	.bar { flex: none; width: 80px; height: 4px; border-radius: var(--r-pill); background: var(--soft); overflow: hidden; }
	.bar i { display: block; height: 100%; background: var(--accent); }

	.status { flex: none; width: 110px; font-size: var(--t12); }

	.problem { color: var(--bad); margin-bottom: var(--s3); }

	@media (max-width: 720px) {
		.resource { flex-wrap: wrap; }
		.bar { width: 100%; order: 3; }
		.status { margin-left: auto; }
	}
</style>

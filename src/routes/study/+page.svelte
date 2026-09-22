<script lang="ts">
	/**
	 * The study dashboard. It composes the workspace widgets and adds nothing
	 * of its own, so anything shown here can be dropped onto any workspace tab
	 * and behave the same way.
	 */
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Widget from '$lib/components/widgets/Widget.svelte';

	let { data } = $props();
	const refresh = () => invalidateAll();
</script>

<svelte:head><title>Study · prosoche</title></svelte:head>

<PageHeader title="Study">
	{#snippet meta()}
		{#if data.workspace}
			<span class="dot" style="--dot: {data.workspace.color}"></span>
			<span>{data.workspace.name}</span>
		{:else}
			<span>whole vault</span>
		{/if}
	{/snippet}
	{#snippet actions()}
		<label class="pick">
			Scope
			<select
				data-testid="study-scope"
				onchange={(e) => {
					const slug = (e.currentTarget as HTMLSelectElement).value;
					location.search = slug ? `?ws=${encodeURIComponent(slug)}` : '';
				}}
			>
				<option value="" selected={!data.workspace}>Whole vault</option>
				{#each data.choices as choice (choice.slug)}
					<option value={choice.slug} selected={data.workspace?.slug === choice.slug}>{choice.name}</option>
				{/each}
			</select>
		</label>
		<a class="btn" href="/study/review{data.workspace ? `?ws=${data.workspace.slug}` : ''}" data-testid="start-review">Review cards</a>
	{/snippet}
</PageHeader>

<div class="widget-grid" data-testid="study-grid">
	{#each data.widgets as widget (widget.name)}
		<Widget {widget} {refresh} />
	{/each}
</div>

<style>
	.dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--dot); }
	.pick { font-size: var(--t12); color: var(--muted); display: flex; align-items: center; gap: 6px; }
	select { font: inherit; font-size: var(--t13); padding: var(--s1) 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--field); }
</style>

<script lang="ts">
	/**
	 * The study dashboard. It composes the workspace widgets and adds nothing
	 * of its own, so anything shown here can be dropped onto any workspace tab
	 * and behave the same way.
	 */
	import { invalidateAll } from '$app/navigation';
	import Widget from '$lib/components/widgets/Widget.svelte';

	let { data } = $props();
	const refresh = () => invalidateAll();
</script>

<svelte:head><title>Study · Hub</title></svelte:head>

<header class="bar">
	<h1>Study</h1>
	{#if data.workspace}
		<span class="dot" style="--dot: {data.workspace.color}"></span>
		<span class="muted">{data.workspace.name}</span>
	{:else}
		<span class="muted">whole vault</span>
	{/if}
	<div class="right">
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
	</div>
</header>

<div class="grid" data-testid="study-grid">
	{#each data.widgets as widget (widget.name)}
		<Widget {widget} {refresh} />
	{/each}
</div>

<style>
	.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
	h1 { margin: 0; font-size: 20px; }
	.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dot); }
	.right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
	.pick { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
	select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; align-items: start; }
	@media (max-width: 720px) {
		.grid { grid-template-columns: 1fr; }
		.pick { display: none; }
	}
</style>

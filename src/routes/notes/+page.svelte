<script lang="ts">
	import FileTree from '$lib/components/FileTree.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Notes · prosoche</title></svelte:head>

<PageHeader title="Notes">
	{#snippet meta()}
		<span>{data.health.notes} notes · {data.health.tasks} tasks</span>
	{/snippet}
</PageHeader>

<div class="card">
	<FileTree nodes={data.tree} />
</div>


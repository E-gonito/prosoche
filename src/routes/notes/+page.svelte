<script lang="ts">
	import FileTree from '$lib/components/FileTree.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Notes · Hub</title></svelte:head>

<div class="head">
	<h1>Notes</h1>
	<span class="muted">{data.health.notes} notes · {data.health.tasks} tasks</span>
</div>

<div class="card">
	<FileTree nodes={data.tree} />
</div>

<style>
	.head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
	.head h1 { margin: 0; font-size: 22px; }
</style>

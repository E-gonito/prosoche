<script lang="ts">
	/**
	 * One of a workspace's custom pages, embedded from the vault.
	 *
	 * `allow-scripts` and nothing else: the page can run its own script, but
	 * `allow-same-origin` is never added, so it can never read this origin's
	 * cookies or storage, or reach out of the frame.
	 */
	let { data } = $props();
</script>

<svelte:head><title>{data.title} · prosoche</title></svelte:head>

<iframe class="embed" title={data.title} src="{encodeURIComponent(data.file)}/raw" sandbox="allow-scripts"></iframe>

<style>
	.embed { display: block; width: 100%; height: 78vh; border: 1px solid var(--line); border-radius: var(--r); background: #fff; }
</style>

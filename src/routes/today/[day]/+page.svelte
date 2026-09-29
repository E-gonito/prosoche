<script lang="ts">
	import TodayView from '$lib/components/TodayView.svelte';
	let { data } = $props();
</script>

<TodayView {data} />

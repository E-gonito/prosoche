<script lang="ts">
	/** Linear's rows, rendered by the same component as GitHub's. */
	import Feed from './Feed.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();
</script>

<Feed {widget} {refresh} />

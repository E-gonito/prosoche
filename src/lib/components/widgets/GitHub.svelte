<script lang="ts">
	/** GitHub's rows. The markup is shared with Linear; only the data differs. */
	import Feed from './Feed.svelte';
	import type { LoadedWidget } from '$lib/shared/widgets';

	let { widget, refresh }: { widget: LoadedWidget; refresh?: () => void } = $props();
</script>

<Feed {widget} {refresh} />

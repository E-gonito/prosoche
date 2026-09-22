<script lang="ts">
	/**
	 * What a widget shows when it has nothing to show.
	 *
	 * Two cases reach here and they are told apart, because the fixes differ: a
	 * loader that threw names what went wrong, and a name the catalogue does
	 * not know is a typo in the workspace file, which is a file the user edits
	 * by hand. Neither takes the rest of the tab down with it.
	 */
	import { WIDGETS, type LoadedWidget } from '$lib/shared/widgets';
	import EmptyState from '$lib/components/EmptyState.svelte';

	let { widget }: { widget: LoadedWidget } = $props();
	const known = $derived(widget.name in WIDGETS);
</script>

{#if widget.problem}
	<EmptyState icon="alert-triangle" title="This widget could not load." hint={widget.problem} />
{:else if !known}
	<EmptyState
		icon="alert-triangle"
		title="No widget is called “{widget.name}”."
		hint="Check the widgets: list in this workspace's file."
	/>
{:else}
	<EmptyState icon="square" title="Nothing to show." />
{/if}

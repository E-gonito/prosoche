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

	let { widget }: { widget: LoadedWidget } = $props();
	const known = $derived(widget.name in WIDGETS);
</script>

<p class="unavailable">
	{#if widget.problem}
		This widget could not load: {widget.problem}
	{:else if !known}
		No widget is called “{widget.name}”. Check the <code>widgets:</code> list in this workspace’s file.
	{:else}
		Nothing to show.
	{/if}
</p>

<style>
	.unavailable { margin: 0; color: var(--muted); font-size: 13px; }
	code { font: 12px var(--mono); }
</style>

<script lang="ts">
	/**
	 * "There is nothing here", rendered the same way everywhere it is true.
	 *
	 * A page with no search results, a workspace tab with no widgets, and a
	 * widget with nothing to list are the same shape: an icon, one sentence for
	 * what is going on, at most one more short line for what to do about it,
	 * and optionally the one action that would fix it. Longer explanations do
	 * not belong on screen at all — they live in docs/how-it-works.md — so this
	 * component has no prop that would invite one back in.
	 *
	 * `children`, if given, renders below the hint and above the action. It
	 * exists for the rare case that is still structured but not prose, such as
	 * the list of environment variables an unconfigured integration names; a
	 * plain sentence should always prefer `hint` instead.
	 *
	 * Never fetches, never mutates, never assumes it is the only thing in its
	 * parent — callers that want it framed as its own card wrap it in one.
	 */
	import Icon, { type IconName } from './Icon.svelte';
	import type { Snippet } from 'svelte';

	let {
		icon,
		title,
		hint,
		testid,
		action,
		children
	}: {
		icon: IconName;
		/** One sentence: what this screen is, or what happened. */
		title: string;
		/** At most one short line: what to do next, if anything. */
		hint?: string;
		/** Placed on the root element, so a caller keeps its existing test hook. */
		testid?: string;
		/** A single button or link, e.g. "Turn it back on". */
		action?: Snippet;
		/** Rare: structured content that is not a sentence. See above. */
		children?: Snippet;
	} = $props();
</script>

<div class="empty-state" data-testid={testid}>
	<Icon name={icon} size={28} />
	<p class="title">{title}</p>
	{#if hint}<p class="hint">{hint}</p>{/if}
	{#if children}{@render children()}{/if}
	{#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 28px var(--s4);
		text-align: center;
		color: var(--muted);
	}
	.empty-state :global(svg) { opacity: 0.6; }
	.title { margin: var(--s1) 0 0; color: var(--text); font-size: var(--t13); font-weight: 500; }
	.hint { margin: 0; font-size: var(--t12); max-width: 46ch; }
	.action { margin-top: 6px; }
</style>

<script lang="ts">
	/**
	 * The heading every page wears: one size, one spacing, one place to change.
	 *
	 * Before this there were nine `.head` blocks with four h1 sizes between
	 * them, so a page felt like a different app depending on how it had been
	 * written. Everything optional is a snippet rather than a prop, because
	 * what sits beside a title differs wildly — a workspace shows a colour dot,
	 * the day shows nothing, study shows a select — and a prop for each would
	 * be a union that grew with every page.
	 *
	 * The wrapper keeps the class `head` and the h1 is a direct child, which is
	 * what the shell's end-to-end test looks for.
	 *
	 * On a narrow screen the actions drop under the title rather than squeezing
	 * it, because the title is what tells you where you are and the actions are
	 * what you reach for second.
	 */
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		back,
		dot,
		testid,
		meta,
		actions
	}: {
		title: string;
		/**
		 * A link out of here, drawn small and above the title, with a chevron
		 * the caller never has to spell out. `label` is plain text: the page
		 * being left, not a glyph glued onto it.
		 */
		back?: { href: string; label: string };
		/** A colour, drawn as a dot before the title: a workspace's own. */
		dot?: string;
		/** Put on the h1, for a test that needs to name this page's subject. */
		testid?: string;
		/** Small print beside the title: a count, a path, a chip. */
		meta?: Snippet;
		/** Buttons and links, right aligned on a wide screen. */
		actions?: Snippet;
	} = $props();
</script>

<header class="head">
	{#if back}
		<a class="back" href={back.href}><Icon name="chevron-left" size={14} />{back.label}</a>
	{/if}
	<div class="line">
		{#if dot}<span class="dot" style="--dot: {dot}"></span>{/if}
		<h1 data-testid={testid}>{title}</h1>
		{#if meta}<div class="meta">{@render meta()}</div>{/if}
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</header>

<style>
	.head {
		margin: 0 0 16px;
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		font-size: 12px;
		color: var(--muted);
		text-decoration: none;
		margin-bottom: 4px;
	}
	.back:hover {
		color: var(--accent);
	}
	.line {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		row-gap: 8px;
	}
	.dot {
		flex: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--dot);
	}
	h1 {
		margin: 0;
		font-size: 22px;
		line-height: 1.2;
		min-width: 0;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	/* Narrow enough that a row of buttons would crowd the title off its line. */
	@media (max-width: 720px) {
		.actions {
			margin-left: 0;
			flex-basis: 100%;
		}
	}
</style>

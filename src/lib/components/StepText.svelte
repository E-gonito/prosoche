<script lang="ts">
	/**
	 * A step's words: `inline code` as code and [[wikilinks]] as links, so a
	 * step can point at a glossary or a note. Everything else is plain text.
	 */
	import { stepPieces } from '$lib/shared/links';

	let { text }: { text: string } = $props();
</script>

{#each stepPieces(text) as piece, i (i)}{#if piece.code}<code>{piece.text}</code>{:else if piece.href}<a href={piece.href}>{piece.text}</a>{:else}{piece.text}{/if}{/each}

<script lang="ts">
	/**
	 * One book, open. The page is the reader and nothing else; everything it
	 * does is in `BookReader`. It is keyed on the book's id so that arriving
	 * from one book to another (a search hit in the palette, say) starts the
	 * reader afresh rather than carrying the last book's state across.
	 */
	import BookReader from '$lib/components/books/BookReader.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.book.title} · prosoche</title></svelte:head>

{#key data.book.id}
	<BookReader {data} />
{/key}

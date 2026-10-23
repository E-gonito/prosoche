<!--
  STUB: replaced by the agent that owns it. The props and the exported
  `goto` are the contract every book reader keeps, so the reader page can
  hold either one.
-->
<script lang="ts">
	import type { BookManifest, Highlight, Place } from '$lib/shared/books';

	interface Props {
		id: string;
		manifest: BookManifest;
		/** Where to open: the place asked for in the URL, else the note's `at:`, else the start. */
		start: Place | null;
		highlights: Highlight[];
		/** Text size, 1 being the book's own. Only the HTML reader uses it; a PDF zooms instead. */
		fontScale: number;
		/** The reader moved: called as often as the place changes; the page debounces saving it. */
		onplace: (place: Place) => void;
		/** Text was selected (with where it is), or the selection went away. */
		onselect: (quote: string | null, place: Place | null) => void;
	}

	let { id, manifest, start, highlights, fontScale, onplace, onselect }: Props = $props();

	/** Show `place`, and when `find` is given, mark that term there and scroll to its first match. */
	export function goto(place: Place, find?: string): void {
		void place;
		void find;
	}

	void [id, manifest, start, highlights, fontScale, onplace, onselect];
</script>

<p>Not built yet.</p>

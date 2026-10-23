<script lang="ts">
	/**
	 * The reader for anything made of HTML: an EPUB's chapters or a saved
	 * site's pages, one at a time in a sandboxed frame.
	 *
	 * The frame is `sandbox="allow-scripts …"` and never `allow-same-origin`,
	 * so the book's page has an opaque origin: it cannot read this app's
	 * pages, storage or cookies, whatever its scripts do. Everything crosses
	 * by `postMessage`, and only messages from this frame's own window that
	 * carry `BRIDGE_SOURCE` are believed (see `bridge-frame.ts` for the other
	 * end). Nothing here knows how a chapter is found or marked; it asks.
	 *
	 * What it does for the page around it (`BookReader`):
	 *  - opens `start`, else the book's first chapter, and reports each place
	 *    the frame reports, as `onplace`; the first is where it opened;
	 *  - reports a selection as `onselect(quote, place)`;
	 *  - follows the app's theme and the `fontScale` prop, and marks this
	 *    chapter's highlights again whenever they change or a chapter loads;
	 *  - relays the book's `localStorage` to the server, which is how a saved
	 *    site's quiz answers follow the author between devices.
	 */
	import { onMount, untrack } from 'svelte';
	import { theme } from '$lib/client/theme.svelte';
	import { BRIDGE_SOURCE, type BookManifest, type FrameMessage, type Highlight, type Place, type ReaderMessage } from '$lib/shared/books';

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

	/** How long after the last change to the book's storage it is sent up. The frame has already waited half a second. */
	const STORAGE_SAVE_MS = 500;

	const chapters = $derived(manifest.chapters ?? []);

	/** The chapter first shown: `start` when it is a chapter of this book, else the first. */
	function opening(): { chapter: string; anchor?: string } {
		const list = manifest.chapters ?? [];
		if (start?.kind === 'html') return { chapter: start.chapter, anchor: start.anchor };
		return { chapter: list[0] ?? 'index.html' };
	}

	const first = untrack(opening);
	/** The chapter the frame was last told to open. It can be ahead of `shown` while a chapter loads. */
	let target = first.chapter;
	/** What to do once the chapter in `target` has said it is ready: scroll here, mark this. Consumed by that. */
	let pending: { anchor?: string; find?: string } = { anchor: first.anchor };
	/** The search term currently marked, kept so a change to the highlights does not clear it. */
	let finding: string | undefined;
	let ready = false;
	/** The chapter the frame last said it loaded, which differs from the one asked for when a link inside the book was followed. */
	let shown = $state<string | null>(null);
	let here: Place | null = null;
	let frame = $state<HTMLIFrameElement>();
	let storageProblem = $state(false);

	const url = (chapter: string) => `/books/${id}/c/${chapter.split('/').map(encodeURIComponent).join('/')}`;
	/**
	 * The frame's first page is set once mounted, not in the markup: a
	 * server-rendered `src` starts loading before the app has hydrated, and a
	 * chapter's `ready` message sent before the listener exists is lost for
	 * good. Later pages are set on the frame itself (see `goto`), so a link
	 * followed inside the book never reloads it.
	 */
	onMount(() => {
		if (frame) frame.src = url(first.chapter);
	});

	/** A message to the frame, without the `source` every one carries. */
	type Down = ReaderMessage extends infer M ? (M extends { source: unknown } ? Omit<M, 'source'> : never) : never;

	function send(msg: Down): void {
		frame?.contentWindow?.postMessage({ ...msg, source: BRIDGE_SOURCE }, '*');
	}

	function sendStyle(): void {
		send({ type: 'style', theme: theme.current, fontScale });
	}

	function sendMarks(): void {
		const chapter = shown ?? target;
		const quotes = highlights.filter((h) => h.place.kind === 'html' && h.place.chapter === chapter).map((h) => h.quote);
		send({ type: 'mark', quotes, find: finding });
	}

	/** Show `place`, and when `find` is given, mark that term there and scroll to its first match. */
	export function goto(place: Place, find?: string): void {
		if (place.kind !== 'html') return;
		finding = find || undefined;
		if (place.chapter === (ready ? shown : target)) {
			if (ready) {
				send({ type: 'goto', anchor: place.anchor });
				sendMarks();
			} else pending = { anchor: place.anchor, find };
			return;
		}
		ready = false;
		pending = { anchor: place.anchor, find };
		target = place.chapter;
		if (frame) frame.src = url(place.chapter);
	}

	function onmessage(event: MessageEvent): void {
		if (!frame || event.source !== frame.contentWindow) return;
		const m = event.data as FrameMessage | null;
		if (!m || typeof m !== 'object' || m.source !== BRIDGE_SOURCE) return;
		if (m.type === 'ready') {
			ready = true;
			shown = target = m.chapter;
			here = { kind: 'html', chapter: m.chapter, anchor: pending.anchor };
			finding = pending.find || undefined;
			sendStyle();
			if (pending.anchor) send({ type: 'goto', anchor: pending.anchor });
			sendMarks();
			pending = {};
			onplace(here);
		} else if (m.type === 'place') {
			here = { kind: 'html', chapter: m.chapter, anchor: m.anchor };
			onplace(here);
		} else if (m.type === 'selection') {
			onselect(m.quote, m.quote === null ? null : here);
		} else if (m.type === 'storage') {
			saveStorage(m.items);
		}
	}

	let storageTimer: ReturnType<typeof setTimeout> | undefined;
	function saveStorage(items: Record<string, string>): void {
		clearTimeout(storageTimer);
		storageTimer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/books/${id}/storage`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
				storageProblem = !res.ok;
				if (!res.ok) console.error(`Saving the book's page state failed: ${res.status}`);
			} catch (e) {
				storageProblem = true;
				console.error("Saving the book's page state failed", e);
			}
		}, STORAGE_SAVE_MS);
	}

	// A change of theme or text size, once a chapter is up.
	$effect(() => {
		void [theme.current, fontScale];
		if (untrack(() => ready)) sendStyle();
	});

	// A change of highlights: mark again (and unmark what was removed).
	$effect(() => {
		void highlights.map((h) => h.quote + h.place.kind);
		if (untrack(() => ready)) sendMarks();
	});

	const index = $derived(chapters.indexOf(shown ?? first.chapter));

	function step(by: -1 | 1): void {
		const next = chapters[index + by];
		if (next) goto({ kind: 'html', chapter: next });
	}
</script>

<svelte:window {onmessage} />

<div class="html-reader">
	<!-- No allow-same-origin, ever: the book's page must stay an opaque origin. -->
	<iframe bind:this={frame} title={manifest.title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" data-testid="book-frame"></iframe>
	{#if chapters.length > 1}
		<nav class="steps" aria-label="Chapters">
			<button class="btn small" disabled={index <= 0} onclick={() => step(-1)} data-testid="prev-chapter">&lsaquo; Previous</button>
			<span class="where">{index >= 0 ? `${index + 1} of ${chapters.length}` : ''}</span>
			<button class="btn small" disabled={index < 0 || index >= chapters.length - 1} onclick={() => step(1)} data-testid="next-chapter">Next &rsaquo;</button>
		</nav>
	{/if}
	{#if storageProblem}<p class="problem" role="alert">This book's page state could not be saved to the server.</p>{/if}
</div>

<style>
	.html-reader {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 24rem;
	}
	iframe {
		flex: 1;
		min-height: 0;
		width: 100%;
		border: 0;
		background: var(--panel);
	}
	.steps {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s3);
		padding: var(--s2) var(--s4);
		border-top: 1px solid var(--line);
		background: var(--panel);
	}
	.where {
		color: var(--muted);
		font-size: var(--t13);
		font-variant-numeric: tabular-nums;
	}
	.problem {
		margin: 0;
		padding: var(--s2) var(--s4);
		background: var(--bad-soft);
		color: var(--bad);
		font-size: var(--t13);
	}
</style>

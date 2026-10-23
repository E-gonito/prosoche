<script lang="ts">
	/**
	 * The reader's shell: everything around the book itself. The book is drawn
	 * by `PdfReader` or `HtmlReader`, which keep one contract (their props and
	 * `goto`); this component owns what the two share.
	 *
	 * - The header: back to Books, the title, where you are.
	 * - Contents and Search panels. Choosing either calls `reader.goto`.
	 * - Text size for HTML books, remembered on this device.
	 * - Your place. The reader reports it; this waits three seconds after the
	 *   last move and `PATCH`es the note, and sends what is pending when the
	 *   page is hidden, closed or left, so a phone that kills the tab loses
	 *   nothing. The first place a reader reports is where it opened, not a
	 *   move, so opening a book never writes. This device's last place is kept
	 *   too, and offered when it differs from the note's.
	 * - Highlights: a selection offers a Highlight button; it takes an optional
	 *   comment and posts, and the reader marks it at once.
	 *
	 * Draws over the whole window (the shell's rail excepted) so the book has
	 * all the room, a phone's toolbar collapsing into one menu.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import { api } from '$lib/client/api';
	import Icon from '$lib/components/Icon.svelte';
	import HtmlReader from './HtmlReader.svelte';
	import PdfReader from './PdfReader.svelte';
	import { FONT_MAX, FONT_MIN, contentsIndex, readFontScale, snippetHtml, stepFontScale } from '$lib/client/books/labels';
	import { parsePlace, placeLabel, placeText, samePlace, type BookHit, type BookManifest, type BookSummary, type Highlight, type Place } from '$lib/shared/books';

	interface Props {
		data: { book: BookSummary; manifest: BookManifest | null; highlights: Highlight[]; at: Place | null; find: string | null };
	}
	let { data }: Props = $props();

	// The reader is chosen once: `BookReader` is keyed on the book by its page.
	/* svelte-ignore state_referenced_locally */
	const { book, manifest } = data;
	/* svelte-ignore state_referenced_locally */
	const start: Place | null = data.at ?? book.at;
	const placeKey = `prosoche:book-place:${book.id}`;
	const fontKey = 'prosoche:book-font-scale';
	const SAVE_AFTER_MS = 3000;

	let reader = $state<{ goto(place: Place, find?: string): void }>();
	/* svelte-ignore state_referenced_locally */
	let highlights = $state<Highlight[]>(data.highlights);
	let here = $state<Place | null>(start);
	let fontScale = $state(1);
	let panel = $state<'contents' | 'search' | null>(null);
	let menuOpen = $state(false);

	const label = $derived(here ? placeLabel(here, manifest) : manifest?.pages ? `${manifest.pages.toLocaleString('en-GB')} pages` : '');
	const isPdf = $derived(book.format === 'pdf');

	// ---- Place: saving, and this device's own -----------------------------------

	/** The place the note holds, as far as this page knows. */
	/* svelte-ignore state_referenced_locally */
	let saved: Place | null = book.at;
	let pending: Place | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** False until the reader has said where it opened; that first report is not a move. */
	let opened = false;
	let saveProblem = $state('');
	/** Where this device was last, read at open, and whether the offer to go there was put away. */
	let deviceAtOpen = $state<Place | null>(null);
	let offerClosed = $state(false);

	const offer = $derived(!data.at && !offerClosed && deviceAtOpen && !samePlace(deviceAtOpen, book.at) ? deviceAtOpen : null);

	function onplace(place: Place) {
		here = place;
		try {
			localStorage.setItem(placeKey, placeText(place));
		} catch {
			// Storage full or off: only this device's memory is lost.
		}
		if (!opened) {
			opened = true;
			return;
		}
		clearTimeout(timer);
		if (samePlace(place, saved)) {
			pending = null;
			return;
		}
		pending = place;
		timer = setTimeout(() => void save(), SAVE_AFTER_MS);
	}

	/** Write the pending place now and report whether it worked. */
	async function save() {
		clearTimeout(timer);
		const place = pending;
		if (!place) return;
		pending = null;
		const result = await api(`/api/books/${book.id}`, { at: placeText(place) }, { method: 'PATCH' });
		if (result.ok) {
			saved = place;
			saveProblem = '';
		} else {
			saveProblem = `Your place was not saved: ${result.message}`;
			pending ??= place;
		}
	}

	/** Send the pending place in a way that survives the page going away. */
	function flush() {
		clearTimeout(timer);
		const place = pending;
		if (!place) return;
		pending = null;
		void fetch(`/api/books/${book.id}`, {
			method: 'PATCH',
			keepalive: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ at: placeText(place) })
		})
			.then((res) => {
				if (res.ok) saved = place;
			})
			.catch(() => {});
	}

	/** Go to a place the person chose; unlike the opening report, this is a move to save. */
	function go(place: Place, find?: string) {
		opened = true;
		reader?.goto(place, find);
	}

	// ---- Text size -------------------------------------------------------------

	function resize(dir: 1 | -1) {
		fontScale = stepFontScale(fontScale, dir);
		try {
			localStorage.setItem(fontKey, String(fontScale));
		} catch {
			// Not remembered; still applied.
		}
	}

	// ---- Contents ----------------------------------------------------------------

	const contents = $derived(manifest?.contents ?? []);
	const currentLine = $derived(contentsIndex(contents, here));
	let list = $state<HTMLElement>();

	async function open(which: 'contents' | 'search') {
		menuOpen = false;
		panel = panel === which ? null : which;
		await tick();
		if (panel === 'contents') list?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
		if (panel === 'search') queryBox?.focus();
	}

	function phone(): boolean {
		return matchMedia('(max-width: 720px)').matches;
	}

	function choose(place: Place) {
		go(place);
		if (phone()) panel = null;
	}

	// ---- Search ------------------------------------------------------------------

	let query = $state('');
	let hits = $state<BookHit[]>([]);
	let searched = $state('');
	let searching = $state(false);
	let searchProblem = $state('');
	let queryBox = $state<HTMLInputElement>();
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let searchAbort: AbortController | undefined;

	const text = $derived(manifest?.text);
	const textNote = $derived.by(() => {
		if (!text) return '';
		if (text.state === 'none') return 'No searchable text in this PDF.';
		if (text.state === 'failed') return `This book's text could not be pulled out: ${text.message}`;
		if (text.state === 'pending') return "This book's text has not been pulled out yet, so search may find little.";
		if (text.state === 'running') return `Still pulling out this book's text (${text.done.toLocaleString('en-GB')} of ${text.total.toLocaleString('en-GB')}), so search may find little yet.`;
		return '';
	});

	function typed() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void search(), 350);
	}

	async function search() {
		clearTimeout(searchTimer);
		const q = query.trim();
		searchAbort?.abort();
		if (!q) {
			hits = [];
			searched = '';
			searchProblem = '';
			searching = false;
			return;
		}
		searchAbort = new AbortController();
		searching = true;
		const result = await api<{ hits: BookHit[] }>(`/api/books/search?q=${encodeURIComponent(q)}&book=${encodeURIComponent(book.id)}`, undefined, { signal: searchAbort.signal });
		if (!result.ok && result.kind === 'offline' && searchAbort.signal.aborted) return;
		searching = false;
		searched = q;
		if (result.ok) {
			hits = result.value.hits;
			searchProblem = '';
		} else {
			hits = [];
			searchProblem = result.message;
		}
	}

	function pick(hit: BookHit) {
		go(hit.place, searched || query.trim());
		if (phone()) panel = null;
	}

	// ---- Highlights --------------------------------------------------------------

	/** What is selected now, as the reader last said. */
	let selection = $state<{ quote: string; place: Place } | null>(null);
	/** The highlight being written: the selection as it was when Highlight was pressed. */
	let draft = $state<{ quote: string; place: Place } | null>(null);
	let comment = $state('');
	let posting = $state(false);
	let highlightProblem = $state('');
	let pressing = false;
	let clearTimer: ReturnType<typeof setTimeout> | undefined;

	function onselect(quote: string | null, place: Place | null) {
		clearTimeout(clearTimer);
		if (quote) {
			const where = place ?? here;
			if (where) selection = { quote, place: where };
			return;
		}
		// Pressing the button can clear the selection first; give it a moment.
		clearTimer = setTimeout(() => {
			if (!pressing) selection = null;
		}, 400);
	}

	function beginHighlight() {
		pressing = false;
		clearTimeout(clearTimer);
		if (!selection) return;
		draft = selection;
		comment = '';
		highlightProblem = '';
	}

	async function saveHighlight() {
		if (!draft || posting) return;
		posting = true;
		highlightProblem = '';
		const body: { quote: string; at: string; comment?: string } = { quote: draft.quote, at: placeText(draft.place) };
		if (comment.trim()) body.comment = comment.trim();
		const result = await api<{ ok: true; highlight: Highlight }>(`/api/books/${book.id}/highlights`, body);
		posting = false;
		if (!result.ok) {
			highlightProblem = `The highlight was not saved: ${result.message}`;
			return;
		}
		highlights = [...highlights, result.value.highlight];
		draft = null;
		selection = null;
		document.getSelection()?.removeAllRanges();
	}

	// ---- Life cycle --------------------------------------------------------------

	onMount(() => {
		fontScale = readFontScale(localStorage.getItem(fontKey));
		const remembered = parsePlace(localStorage.getItem(placeKey));
		if (remembered && (remembered.kind === 'page') === isPdf) deviceAtOpen = remembered;
		// The reader is mounted by now; it holds the place until its book is open.
		// Not `go`: opening on a search hit is not a move to save.
		if (data.find && start) reader?.goto(start, data.find);
	});

	onDestroy(() => {
		clearTimeout(searchTimer);
		clearTimeout(clearTimer);
		searchAbort?.abort();
		if (typeof document !== 'undefined') flush();
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (draft) draft = null;
		else if (menuOpen) menuOpen = false;
		else if (panel) panel = null;
	}
</script>

<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && flush()} />
<svelte:window onpagehide={flush} {onkeydown} />

{#snippet actions()}
	<button class="tool" class:on={panel === 'contents'} onclick={() => open('contents')} disabled={!manifest} aria-pressed={panel === 'contents'} data-testid="open-contents">
		<Icon name="list" /><span>Contents</span>
	</button>
	<button class="tool" class:on={panel === 'search'} onclick={() => open('search')} disabled={!manifest} aria-pressed={panel === 'search'} data-testid="open-search">
		<Icon name="search" /><span>Search</span>
	</button>
	{#if !isPdf}
		<span class="size" role="group" aria-label="Text size">
			<button class="tool" onclick={() => resize(-1)} disabled={fontScale <= FONT_MIN} aria-label="Smaller text" data-testid="text-smaller">A<small>−</small></button>
			<button class="tool" onclick={() => resize(1)} disabled={fontScale >= FONT_MAX} aria-label="Larger text" data-testid="text-larger">A<small>+</small></button>
		</span>
	{/if}
{/snippet}

<div class="shell" data-testid="book-reader">
	<header class="bar">
		<a class="back" href="/books" aria-label="Back to Books"><Icon name="chevron-left" size={20} /><span>Books</span></a>
		<div class="heading">
			<h1 title={book.title}>{book.title}</h1>
			{#if label}<p class="where" data-testid="place-label">{label}</p>{/if}
		</div>
		<div class="tools">{@render actions()}</div>
		<div class="menu-wrap">
			<button class="icon-btn" onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen} aria-label="Reader menu" data-testid="reader-menu"><Icon name="menu" size={22} /></button>
			{#if menuOpen}
				<div class="menu" role="menu">{@render actions()}</div>
			{/if}
		</div>
	</header>

	{#if offer}
		<div class="banner" role="status" data-testid="device-offer">
			<span>On this device you were at {placeLabel(offer, manifest)}.</span>
			<button class="btn small" onclick={() => { go(offer); offerClosed = true; }}>Go there</button>
			<button class="icon-btn" onclick={() => (offerClosed = true)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
		</div>
	{/if}
	{#if saveProblem}<p class="banner bad" role="alert" data-testid="save-problem">{saveProblem}</p>{/if}

	<main class="stage">
		<div class="book">
			{#if !manifest}
				<div class="missing" data-testid="book-missing">
					<p>This book's file isn't on the server. <a href="/books">Upload it again from Books.</a></p>
				</div>
			{:else if isPdf}
				<PdfReader bind:this={reader} id={book.id} {manifest} {start} {highlights} {fontScale} {onplace} {onselect} />
			{:else}
				<HtmlReader bind:this={reader} id={book.id} {manifest} {start} {highlights} {fontScale} {onplace} {onselect} />
			{/if}
		</div>

		{#if panel}
			<aside class="panel" aria-label={panel === 'contents' ? 'Contents' : 'Search this book'}>
				<div class="panel-head">
					<h2>{panel === 'contents' ? 'Contents' : 'Search this book'}</h2>
					<button class="icon-btn" onclick={() => (panel = null)} aria-label="Close"><Icon name="x" size={18} /></button>
				</div>
				{#if panel === 'contents'}
					{#if contents.length}
						<ul class="contents" bind:this={list} data-testid="contents">
							{#each contents as entry, i (i)}
								<li>
									<button class:current={i === currentLine} aria-current={i === currentLine ? 'true' : undefined} style:padding-left="{12 + entry.depth * 16}px" onclick={() => choose(entry.place)}>
										{entry.title}
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">This book has no contents list.</p>
					{/if}
				{:else}
					<form class="search" onsubmit={(e) => { e.preventDefault(); void search(); }}>
						<input class="field" type="search" placeholder="Search this book" bind:value={query} bind:this={queryBox} oninput={typed} disabled={text?.state === 'none'} aria-label="Search this book" data-testid="book-search" />
					</form>
					{#if textNote}<p class="hint" data-testid="text-note">{textNote}</p>{/if}
					{#if searchProblem}
						<p class="hint bad" role="alert">{searchProblem}</p>
					{:else if searching}
						<p class="hint">Searching…</p>
					{:else if searched && !hits.length}
						<p class="hint">Nothing found for “{searched}”.</p>
					{/if}
					<ul class="hits" data-testid="hits">
						{#each hits as hit, i (i)}
							<li>
								<button onclick={() => pick(hit)}>
									<span class="hit-label">{hit.label}</span>
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped by snippetHtml, which allows only <mark> -->
									<span class="snippet">{@html snippetHtml(hit.snippet)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</aside>
		{/if}
	</main>

	{#if draft}
		<div class="compose" role="dialog" aria-label="Highlight" data-testid="highlight-form">
			<blockquote>{draft.quote.length > 200 ? `${draft.quote.slice(0, 200)}…` : draft.quote}</blockquote>
			<textarea class="field" rows="2" placeholder="A comment (optional)" bind:value={comment} aria-label="Comment" data-testid="highlight-comment"></textarea>
			{#if highlightProblem}<p class="problem" role="alert">{highlightProblem}</p>{/if}
			<div class="row">
				<button class="btn primary" onclick={saveHighlight} disabled={posting} data-testid="highlight-save">{posting ? 'Saving…' : 'Save highlight'}</button>
				<button class="btn" onclick={() => (draft = null)} disabled={posting}>Cancel</button>
			</div>
		</div>
	{:else if selection}
		<button
			class="highlight btn primary"
			onpointerdown={(e) => { pressing = true; e.preventDefault(); }}
			onclick={beginHighlight}
			data-testid="highlight-button"
		>Highlight</button>
	{/if}
</div>

<style>
	/* Over the whole window, leaving the desktop rail; a phone's header and tab bar give way to the book. */
	.shell {
		position: fixed;
		inset: 0 0 0 var(--rail-w);
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	@media (max-width: 720px) {
		.shell {
			left: 0;
		}
	}

	.bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--s2);
		min-height: var(--header-h);
		padding: env(safe-area-inset-top) var(--s3) 0;
		border-bottom: 1px solid var(--line);
		background: var(--panel);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		min-height: 44px;
		padding-right: var(--s2);
		color: var(--muted);
		font-size: var(--t14);
	}
	.back:hover {
		color: var(--text);
		text-decoration: none;
	}
	.heading {
		flex: 1;
		min-width: 0;
	}
	.heading h1 {
		margin: 0;
		font-size: var(--t16);
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.where {
		margin: 0;
		color: var(--muted);
		font-size: var(--t12);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tools {
		display: flex;
		align-items: center;
		gap: var(--s1);
	}
	.menu-wrap {
		display: none;
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 190px;
		padding: var(--s2);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-lg);
	}
	.menu .tool {
		min-height: 44px;
	}
	.menu .size {
		display: flex;
		gap: 2px;
	}
	@media (max-width: 720px) {
		.tools {
			display: none;
		}
		.menu-wrap {
			display: block;
		}
	}

	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px var(--s3);
		border: 1px solid transparent;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--t14);
		cursor: pointer;
	}
	.tool:hover:not(:disabled) {
		background: var(--soft);
	}
	.tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tool.on {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.tool small {
		font-size: var(--t11);
	}
	.size {
		display: inline-flex;
	}

	.banner {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: 0;
		padding: var(--s2) var(--s4);
		background: var(--sand);
		border-bottom: 1px solid var(--sand-edge);
		font-size: var(--t14);
	}
	.banner span {
		flex: 1;
	}
	.banner.bad {
		background: var(--bad-soft);
		border-color: var(--bad);
	}

	/* The book and, beside it on a desktop, the open panel; a phone's panel covers the book. */
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.book {
		position: relative;
		flex: 1;
		min-width: 0;
	}
	.missing {
		display: grid;
		place-items: center;
		height: 100%;
		padding: var(--s5);
		text-align: center;
		color: var(--muted);
	}

	.panel {
		flex: none;
		width: 380px;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		border-left: 1px solid var(--line);
	}
	@media (max-width: 720px) {
		.panel {
			position: absolute;
			inset: 0;
			z-index: 10;
			width: auto;
			border-left: 0;
		}
	}
	.panel-head {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--s2) var(--s3) var(--s2) var(--s4);
		border-bottom: 1px solid var(--line);
	}
	.panel-head h2 {
		margin: 0;
		font-size: var(--t16);
	}
	.contents,
	.hits {
		flex: 1;
		min-height: 0;
		margin: 0;
		padding: var(--s1) 0;
		list-style: none;
		overflow-y: auto;
	}
	.contents button,
	.hits button {
		display: block;
		width: 100%;
		min-height: 40px;
		padding: var(--s2) var(--s4);
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--t14);
		text-align: left;
		cursor: pointer;
	}
	.contents button:hover,
	.hits button:hover {
		background: var(--soft);
	}
	.contents button.current {
		color: var(--accent);
		font-weight: 600;
		background: var(--accent-soft);
	}
	.search {
		flex: none;
		padding: var(--s3) var(--s4) var(--s1);
	}
	.hint {
		flex: none;
		margin: var(--s2) var(--s4);
		color: var(--muted);
		font-size: var(--t13);
	}
	.hint.bad {
		color: var(--bad);
	}
	.hit-label {
		display: block;
		color: var(--muted);
		font-size: var(--t12);
	}
	.snippet {
		display: block;
		line-height: 1.4;
	}
	.snippet :global(mark) {
		background: var(--mark);
		color: inherit;
		border-radius: 2px;
	}

	.highlight {
		position: absolute;
		left: 50%;
		bottom: calc(var(--s5) + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 20;
		min-height: 44px;
		padding: 0 var(--s5);
		box-shadow: var(--shadow-lg);
	}
	.compose {
		position: absolute;
		left: 50%;
		bottom: calc(var(--s4) + env(safe-area-inset-bottom));
		transform: translateX(-50%);
		z-index: 20;
		width: min(440px, calc(100% - 2 * var(--s3)));
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s3) var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-lg);
	}
	.compose blockquote {
		margin: 0;
		padding-left: var(--s3);
		border-left: 3px solid var(--accent);
		color: var(--muted);
		font-size: var(--t13);
		max-height: 5.5em;
		overflow: auto;
	}
	.compose .row {
		display: flex;
		gap: var(--s2);
	}
	.problem {
		margin: 0;
		color: var(--bad);
		font-size: var(--t13);
	}
</style>

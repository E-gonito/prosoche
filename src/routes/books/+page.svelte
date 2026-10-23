<script lang="ts">
	/**
	 * Books: a card for every book, a box to add one, and a search across all
	 * of them.
	 *
	 * Adding is one step: drop a file anywhere in the box, choose one (a phone
	 * opens Files or Drive), or paste a web address. A file goes up as its own
	 * bytes, one at a time (`POST /api/books?name=`); an address is saved by
	 * the server as a copy, which can take a minute. The cards refresh every
	 * three seconds while any book is still having its text pulled out.
	 */
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/client/api';
	import Confirm from '$lib/components/Confirm.svelte';
	import { placeText, type BookHit, type BookSummary } from '$lib/shared/books';

	let { data } = $props();

	let dragging = $state(false);
	let busy = $state(false);
	let status = $state('');
	let problem = $state('');
	let address = $state('');
	let input = $state<HTMLInputElement>();
	let removing = $state<BookSummary | null>(null);

	let query = $state('');
	let hits = $state<BookHit[]>([]);
	let searched = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	const TYPES: Record<string, string> = { pdf: 'application/pdf', epub: 'application/epub+zip' };

	const indexing = $derived(data.books.some((b) => b.text?.state === 'pending' || b.text?.state === 'running'));
	$effect(() => {
		if (!indexing) return;
		const t = setInterval(() => void invalidateAll(), 3000);
		return () => clearInterval(t);
	});

	function mb(bytes: number): string {
		return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
	}

	/** The upload type for a file: its own if it is one we take, else from its extension. */
	function typeOf(file: File): string | null {
		if (file.type === 'application/pdf' || file.type === 'application/epub+zip') return file.type;
		return TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
	}

	/** Send each file in turn; stops at the first the server refuses and says why. */
	async function upload(files: Iterable<File>) {
		if (busy) return;
		busy = true;
		problem = '';
		let added = 0;
		try {
			for (const file of files) {
				const type = typeOf(file);
				if (!type) {
					problem = `${file.name} is not a PDF or an EPUB.`;
					break;
				}
				status = `Sending ${file.name} (${mb(file.size)}) and reading it. A big book takes a while.`;
				let res: Response;
				try {
					res = await fetch(`/api/books?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': type }, body: file });
				} catch {
					problem = 'No answer from the server. Check the connection and try again.';
					break;
				}
				const answer = await res.json().catch(() => ({ ok: false, error: res.status === 413 ? 'That file is too big for the server.' : 'That did not work.' }));
				if (!res.ok || !answer.ok) {
					problem = `${file.name}: ${answer.error ?? 'That did not work.'}`;
					break;
				}
				added++;
				status = answer.existing ? `${answer.title} was already here; its place and highlights are kept.` : `Added ${answer.title}.`;
				await invalidateAll();
			}
		} finally {
			busy = false;
			if (!added) status = '';
		}
	}

	async function saveAddress(event: SubmitEvent) {
		event.preventDefault();
		const url = address.trim();
		if (!url || busy) return;
		busy = true;
		problem = '';
		status = 'Saving a copy of the site. This can take a minute.';
		const result = await api<{ title: string; existing: boolean }>('/api/books', { url });
		busy = false;
		if (!result.ok) {
			problem = result.message;
			status = '';
			return;
		}
		address = '';
		status = result.value.existing ? `Refreshed ${result.value.title}; its place and highlights are kept.` : `Added ${result.value.title}.`;
		await invalidateAll();
	}

	async function remove(book: BookSummary) {
		removing = null;
		const result = await api(`/api/books/${book.id}`, undefined, { method: 'DELETE' });
		if (!result.ok) problem = result.message;
		else status = `Removed ${book.title}'s files. Its note, place and highlights are kept.`;
		await invalidateAll();
	}

	function search() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			hits = [];
			searched = false;
			return;
		}
		timer = setTimeout(async () => {
			const result = await api<{ hits: BookHit[] }>(`/api/books/search?q=${encodeURIComponent(q)}`);
			if (q !== query.trim()) return;
			hits = result.ok ? result.value.hits : [];
			searched = true;
		}, 200);
	}

	/** The index marks matches with « and »; drawn here as highlights. */
	function marked(snippet: string): string {
		const escaped = snippet.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
		return escaped.replace(/«/g, '<mark>').replace(/»/g, '</mark>');
	}

	function hitHref(hit: BookHit): string {
		return `/books/${hit.book}?at=${encodeURIComponent(placeText(hit.place))}&find=${encodeURIComponent(query.trim())}`;
	}

	/** One line about a book's text, or '' when there is nothing to say. */
	function textLine(book: BookSummary): string {
		const t = book.text;
		if (!t) return '';
		if (t.state === 'pending') return 'Waiting to be indexed for search…';
		if (t.state === 'running') return `Indexing, ${t.done.toLocaleString('en-GB')} of ${t.total.toLocaleString('en-GB')}`;
		if (t.state === 'none') return 'No searchable text in this PDF';
		if (t.state === 'failed') return `Could not be indexed: ${t.message}`;
		return '';
	}
</script>

<svelte:head><title>Books · prosoche</title></svelte:head>

<div class="page wide">
	<div class="title">
		<h1>Books</h1>
		<p>PDFs, EPUBs and websites, opened where you left off on any device.</p>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="drop"
		class:dragging
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragging = false;
			void upload([...(e.dataTransfer?.files ?? [])]);
		}}
		data-testid="drop"
	>
		<div class="how">
			<p class="pointer"><b>Drop a PDF or EPUB here</b>, or</p>
			<button type="button" class="btn primary" onclick={() => input?.click()} disabled={busy} data-testid="choose-file">Choose a file</button>
			<input
				bind:this={input}
				class="hidden"
				type="file"
				multiple
				accept=".pdf,.epub,application/pdf,application/epub+zip"
				onchange={(e) => {
					void upload([...(e.currentTarget.files ?? [])]);
					e.currentTarget.value = '';
				}}
				data-testid="file-input"
			/>
		</div>
		<form class="url" onsubmit={saveAddress}>
			<input class="field" type="url" bind:value={address} placeholder="…or paste a web address" aria-label="Web address of a book" disabled={busy} data-testid="book-url" />
			<button class="btn" disabled={busy || !address.trim()} data-testid="save-url">Save a copy</button>
		</form>
	</div>
	{#if busy && status}<p class="working muted" role="status" data-testid="book-status">{status}</p>{/if}
	{#if !busy && status}<p class="done" role="status" data-testid="book-status">{status}</p>{/if}
	{#if problem}<p class="problem" role="alert" data-testid="book-problem">{problem}</p>{/if}

	<input class="field search" type="search" placeholder="Search all books…" bind:value={query} oninput={search} aria-label="Search all books" data-testid="books-search" />
	{#if query.trim() && searched}
		<div class="sheet rows results" data-testid="books-hits">
			{#each hits as hit, i (`${hit.book}-${placeText(hit.place)}-${i}`)}
				<a class="hit" href={hitHref(hit)}>
					<b>{hit.title}</b>
					<span class="muted small">{hit.label}</span>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<span class="snippet">{@html marked(hit.snippet)}</span>
				</a>
			{:else}
				<p class="empty">Nothing in your books matches “{query.trim()}”.</p>
			{/each}
		</div>
	{/if}

	<div class="grid" data-testid="books">
		{#each data.books as book (book.id)}
			<article class="card" class:gone={!book.onShelf} data-testid="book">
				<a class="open" href="/books/{book.id}">
					<span class="name">{book.title}</span>
					<span class="meta muted small">
						{book.format.toUpperCase()}{#if book.atLabel}<span aria-hidden="true"> · </span>{book.atLabel}{:else if book.onShelf}<span aria-hidden="true"> · </span>not started{/if}
					</span>
				</a>
				{#if !book.onShelf}
					<p class="again" data-testid="upload-again">
						<b>{book.format === 'site' ? 'Save the site again' : 'Upload the file again'}</b>
						<span class="muted small">{book.format === 'site' ? book.source : `${book.source || 'The file'} is no longer on the server. Your place and highlights are kept.`}</span>
					</p>
					{#if book.format !== 'site'}
						<button type="button" class="btn small" onclick={() => input?.click()} disabled={busy}>Choose the file</button>
					{/if}
				{:else if textLine(book)}
					<p class="text muted small" class:bad={book.text?.state === 'failed'} data-testid="text-state">{textLine(book)}</p>
				{/if}
				{#if book.onShelf}
					<button type="button" class="btn ghost small remove" onclick={() => (removing = book)} aria-label="Remove {book.title} from the server" data-testid="remove-book">Remove</button>
				{/if}
			</article>
		{:else}
			<p class="empty">No books yet. Add a PDF, an EPUB or a web address above.</p>
		{/each}
	</div>

	<p class="foot muted small" data-testid="books-free">{mb(data.free)} free on the server.</p>
</div>

{#if removing}
	<Confirm
		title="Remove {removing.title}?"
		body="This deletes the book's files from the server. Its note, with your place and highlights, stays, and adding the same file again finds them."
		confirmLabel="Remove files"
		danger
		onconfirm={() => removing && remove(removing)}
		oncancel={() => (removing = null)}
	/>
{/if}

<style>
	.drop {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s4);
		flex-wrap: wrap;
		padding: var(--s4);
		margin-bottom: var(--s3);
		border: 2px dashed var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
	}
	.drop.dragging { border-color: var(--accent); background: var(--accent-soft); }
	.how { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
	.how p { margin: 0; }
	.url { display: flex; gap: var(--s2); flex: 1; min-width: 240px; max-width: 520px; }
	.url .field { flex: 1; min-width: 0; width: auto; }
	.hidden { display: none; }
	/* A phone cannot drop a file, so it is only told to choose one. */
	@media (hover: none) and (pointer: coarse) {
		.pointer { display: none; }
	}
	.working, .done { margin: 0 0 var(--s3); font-size: var(--t14); }
	.search { margin: var(--s3) 0; }
	.results { margin-bottom: var(--s4); }
	.hit { display: flex; flex-direction: column; gap: 2px; padding: var(--s2) var(--s3); color: var(--text); }
	.hit:hover { background: var(--soft); text-decoration: none; }
	.snippet :global(mark) { background: var(--mark); color: inherit; }
	.results .empty { padding: var(--s3); }

	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s3); margin-top: var(--s4); }
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--s2);
		padding: var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--panel);
	}
	.card:hover { border-color: var(--accent); }
	.card.gone { border-style: dashed; }
	.open { display: flex; flex-direction: column; gap: 2px; color: var(--text); }
	.open:hover { text-decoration: none; }
	.name { font-weight: 600; font-family: var(--serif); font-size: var(--t16, 16px); overflow-wrap: anywhere; }
	.again { display: flex; flex-direction: column; gap: 2px; margin: 0; }
	.text { margin: 0; }
	.text.bad { color: var(--bad); }
	.remove { align-self: flex-start; margin-top: auto; }
	.foot { margin-top: var(--s5); }
</style>

/**
 * Searching books: keeping the index's book text true to the shelf, and
 * asking it. The text itself is pulled out by `text.ts`; the SQL is in
 * `index/`.
 *
 * Extraction is the heavy part, so there is one queue for the whole process
 * and it works on one book at a time. Each book yields to the event loop
 * between pages (see `pullText`), so requests are answered while a
 * 1,100-page book is read; a second book waits its turn rather than doubling
 * the memory and the CPU the 2-core container has.
 */

import type { NoteIndex } from '../index/index';
import type { Shelf } from '../vault/shelf';
import { parsePlace, placeText, type BookHit, type BookManifest, type Place } from '$lib/shared/books';
import { readManifest, updateManifest } from './manifest';
import { pullText, readText } from './text';

/** Progress is written to the manifest at most this often (ms), or this many pages apart, whichever comes first. */
const PROGRESS_MS = 2000;
const PROGRESS_PAGES = 25;

interface Job {
	shelf: Shelf;
	index: NoteIndex;
	id: string;
}

const waiting: Job[] = [];
let current: string | null = null;
let draining: Promise<void> | null = null;

/**
 * Pull a book's text out in the background, one book at a time across the
 * whole server, recording progress in its manifest's `text`, then put it in
 * the index. Returns at once. Queuing a book already queued or running does
 * nothing more.
 */
export function queueText(shelf: Shelf, index: NoteIndex, id: string): void {
	if (current === id || waiting.some((j) => j.id === id)) return;
	waiting.push({ shelf, index, id });
	draining ??= drain().finally(() => {
		draining = null;
	});
}

/** Resolves when nothing is queued or running. For tests and for shutting down cleanly. */
export function textIdle(): Promise<void> {
	return draining ?? Promise.resolve();
}

async function drain(): Promise<void> {
	for (let job = waiting.shift(); job; job = waiting.shift()) {
		current = job.id;
		try {
			await run(job);
		} catch (e) {
			console.warn(`[books] text for ${job.id} stopped: ${e instanceof Error ? e.message : String(e)}`);
		}
		current = null;
	}
}

async function run({ shelf, index, id }: Job): Promise<void> {
	const manifest = await readManifest(shelf, id);
	if (!manifest) {
		console.warn(`[books] text for ${id} skipped: not on the shelf`);
		return;
	}
	const total = manifest.format === 'pdf' ? (manifest.pages ?? 0) : (manifest.chapters?.length ?? 0);
	const started = Date.now();
	console.log(`[books] text ${id} (${manifest.title}) started: ${total} ${manifest.format === 'pdf' ? 'pages' : 'chapters'}`);
	await updateManifest(shelf, id, { text: { state: 'running', done: 0, total } });

	let lastDone = 0;
	let lastAt = started;
	const state = await pullText(shelf, manifest, (done, of) => {
		const now = Date.now();
		if (done - lastDone < PROGRESS_PAGES && now - lastAt < PROGRESS_MS) return;
		lastDone = done;
		lastAt = now;
		void updateManifest(shelf, id, { text: { state: 'running', done, total: of } });
	});

	// Null when the book was removed while it was being read: leave the index alone.
	const recorded = await updateManifest(shelf, id, { text: state });
	if (recorded && state.state === 'done') {
		const entries = (await readText(shelf, id)) ?? [];
		index.putBookText(
			id,
			entries.map((e) => ({ place: placeText(e.place), label: e.label, text: e.text }))
		);
	}
	const took = ((Date.now() - started) / 1000).toFixed(1);
	const result = state.state === 'done' ? `${state.parts} parts` : state.state === 'failed' ? `failed: ${state.message}` : state.state;
	console.log(`[books] text ${id} finished in ${took} s: ${result}`);
}

/**
 * At start: put every book's `text.json` in the index, and queue any book
 * whose text is still `pending` or was `running` when the server stopped.
 * A book marked `done` whose `text.json` has gone is queued again. Never
 * throws; a book that cannot be read is logged and skipped.
 */
export async function reindexBooks(shelf: Shelf, index: NoteIndex): Promise<void> {
	let ids: string[] = [];
	try {
		ids = await shelf.ids();
	} catch (e) {
		console.warn(`[books] could not list the shelf: ${e instanceof Error ? e.message : String(e)}`);
		return;
	}
	let loaded = 0;
	for (const id of ids) {
		try {
			const manifest = await readManifest(shelf, id);
			if (!manifest) {
				console.warn(`[books] ${id} has no readable book.json; skipped`);
				continue;
			}
			const entries = await readText(shelf, id);
			if (entries) {
				index.putBookText(
					id,
					entries.map((e) => ({ place: placeText(e.place), label: e.label, text: e.text }))
				);
				loaded++;
			} else index.forgetBookText(id);
			if (needsText(manifest, entries !== null)) queueText(shelf, index, id);
		} catch (e) {
			console.warn(`[books] could not index ${id}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	if (ids.length) console.log(`[books] indexed the text of ${loaded} of ${ids.length} books`);
}

function needsText(manifest: BookManifest, hasFile: boolean): boolean {
	const state = manifest.text.state;
	return state === 'pending' || state === 'running' || (state === 'done' && !hasFile);
}

/** Drop a book's text from the index, when the book is removed. Also takes it off the queue if it has not started. */
export function forgetBookText(index: NoteIndex, id: string): void {
	const at = waiting.findIndex((j) => j.id === id);
	if (at >= 0) waiting.splice(at, 1);
	index.forgetBookText(id);
}

/**
 * Search the books' text, best first. `book` limits it to one book. Titles
 * come from the manifest; a hit in a book that is no longer on the shelf is
 * left out. An empty or unparsable query is no hits.
 */
export async function searchBooks(index: NoteIndex, shelf: Shelf, query: string, opts: { book?: string; limit?: number } = {}): Promise<BookHit[]> {
	const found = index.searchBookText(query, opts);
	const titles = new Map<string, string | null>();
	const hits: BookHit[] = [];
	for (const hit of found) {
		if (!titles.has(hit.book)) titles.set(hit.book, (await readManifest(shelf, hit.book))?.title ?? null);
		const title = titles.get(hit.book);
		const place = parsePlace(hit.place) ?? looseHtmlPlace(hit.place);
		if (title && place) hits.push({ book: hit.book, title, place, label: hit.label, snippet: hit.snippet });
	}
	return hits;
}

/**
 * `parsePlace` refuses a chapter path with a space in it, which an EPUB's file
 * can have. The index only holds places this module wrote from real
 * chapters, so one `parsePlace` refused is still a place: cut at the first
 * `#`. Null only for a bare page-like string or an empty chapter.
 */
function looseHtmlPlace(text: string): Place | null {
	const hash = text.indexOf('#');
	const chapter = hash < 0 ? text : text.slice(0, hash);
	if (!chapter || /^p\.\s*\d+$/.test(text)) return null;
	return hash < 0 || hash === text.length - 1 ? { kind: 'html', chapter } : { kind: 'html', chapter, anchor: text.slice(hash + 1) };
}

/**
 * Searching books: keeping the index's book text true to the shelf, and
 * asking it. The text itself is pulled out by `text.ts`; the SQL is in
 * `index/`.
 *
 * STUB: agent C replaces this file. The contract below is fixed.
 */

import type { NoteIndex } from '../index/index';
import type { Shelf } from '../vault/shelf';
import type { BookHit } from '$lib/shared/books';

/**
 * Pull a book's text out in the background, one book at a time across the
 * whole server, recording progress in its manifest's `text`, then put it in
 * the index. Returns at once. Queuing a book already queued or running does
 * nothing more.
 */
export function queueText(shelf: Shelf, index: NoteIndex, id: string): void {
	void shelf;
	void index;
	void id;
	throw new Error('queueText: not built yet');
}

/**
 * At start: put every book's `text.json` in the index, and queue any book
 * whose text is still `pending` or was `running` when the server stopped.
 * Never throws; a book that cannot be read is logged and skipped.
 */
export async function reindexBooks(shelf: Shelf, index: NoteIndex): Promise<void> {
	void shelf;
	void index;
	throw new Error('reindexBooks: not built yet');
}

/** Drop a book's text from the index, when the book is removed. */
export function forgetBookText(index: NoteIndex, id: string): void {
	void index;
	void id;
	throw new Error('forgetBookText: not built yet');
}

/**
 * Search the books' text, best first. `book` limits it to one book. Titles
 * come from the manifest. An empty or unparsable query is no hits.
 */
export async function searchBooks(index: NoteIndex, shelf: Shelf, query: string, opts: { book?: string; limit?: number } = {}): Promise<BookHit[]> {
	void index;
	void shelf;
	void query;
	void opts;
	throw new Error('searchBooks: not built yet');
}

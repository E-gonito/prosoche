/**
 * Saving a book that is a website (an mdBook such as the Rust book) as a copy
 * on the shelf, chapters and assets, so it reads, searches and remembers the
 * place like any other book.
 *
 * STUB: agent E replaces this file. The contract below is fixed.
 */

import type { Shelf } from '../vault/shelf';
import type { ContentsEntry } from '$lib/shared/books';

export type SiteRefusal = { ok: false; reason: 'bad-url' | 'unreachable' | 'not-a-book' | 'too-large' | 'no-space'; message: string };

/**
 * Save the site at `url` into book `id`'s `html/` folder: every chapter
 * page, and every script, style, font and image they use from the same site.
 * Answers the title, the chapters in reading order (relative to `html/`) and
 * the contents. Replaces an `html/` folder already there only once the new
 * copy is complete, so a failed refresh keeps the old copy.
 *
 * `fetch` is injectable for tests. Refuses private, loopback and tailnet
 * addresses unless `config.books.allowLocalFetch`. Never throws.
 */
export async function saveSite(
	shelf: Shelf,
	id: string,
	url: string,
	opts: { fetch?: typeof fetch; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ ok: true; title: string; chapters: string[]; contents: ContentsEntry[] } | SiteRefusal> {
	void shelf;
	void id;
	void url;
	void opts;
	throw new Error('saveSite: not built yet');
}

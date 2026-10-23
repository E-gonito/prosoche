/**
 * Unpacking an EPUB into HTML chapters, so it reads in the same reader as a
 * saved site.
 *
 * STUB: agent D replaces this file. The contract below is fixed.
 */

import type { Shelf } from '../vault/shelf';
import type { ContentsEntry } from '$lib/shared/books';

/**
 * Unpack the book's `original.epub` into its `html/` folder, every file at
 * its path in the zip, and read its title, its spine (`chapters`, in reading
 * order, relative to `html/`) and its table of contents (EPUB 3 nav, or the
 * EPUB 2 NCX). Replaces an `html/` folder already there. Refuses `bad-epub`
 * for a file that is not a readable EPUB, or one with an entry that would
 * unpack outside the folder; nothing is left in `html/` then. Never throws.
 */
export async function unpackEpub(
	shelf: Shelf,
	id: string
): Promise<{ ok: true; title: string | null; chapters: string[]; contents: ContentsEntry[] } | { ok: false; reason: 'bad-epub'; message: string }> {
	void shelf;
	void id;
	throw new Error('unpackEpub: not built yet');
}

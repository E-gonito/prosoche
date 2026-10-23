/**
 * What a PDF says about itself, for the manifest: its title, how many pages
 * it has, and its outline (bookmarks) as contents. Uses pdf.js, the same
 * library the reader draws pages with.
 *
 * STUB: agent C replaces this file. The contract below is fixed.
 */

import type { ContentsEntry } from '$lib/shared/books';

/**
 * Read a PDF's metadata from its bytes. `title` is the document's own title
 * when it has a sensible one, else null (the caller falls back to the file
 * name). `contents` is the outline flattened in order, each entry a page
 * place; empty when the PDF has no outline. Refuses `bad-pdf` for bytes
 * pdf.js cannot open, including an encrypted PDF. Never throws.
 */
export async function readPdf(
	bytes: Uint8Array
): Promise<{ ok: true; title: string | null; pages: number; contents: ContentsEntry[] } | { ok: false; reason: 'bad-pdf'; message: string }> {
	void bytes;
	throw new Error('readPdf: not built yet');
}

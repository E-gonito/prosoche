/**
 * Serving a book's HTML (an EPUB's chapters, a saved site's pages and their
 * assets) into the reader's sandboxed frame: the right type, a strict CSP,
 * and prosoche's bridge script injected into every page.
 *
 * STUB: agent D replaces this file. The contract below is fixed.
 */

import type { Shelf } from '../vault/shelf';
import type { BookManifest } from '$lib/shared/books';

/**
 * The response for `path` (relative to the book's `html/` folder) as the
 * frame at `/books/<id>/c/<path>` asks for it, or null when there is no such
 * file. An HTML page gets the bridge and the CSP from `docs/plan-books.md`
 * decision 7; an asset gets its type and a CORS header so an opaque-origin
 * frame may use a font or module. Never throws for a missing file.
 */
export async function serveChapter(shelf: Shelf, manifest: BookManifest, path: string, request: Request): Promise<Response | null> {
	void shelf;
	void manifest;
	void path;
	void request;
	throw new Error('serveChapter: not built yet');
}

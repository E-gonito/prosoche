import { hub } from '$server/hub';
import { isBookId } from '$server/books/id';
import { readManifest } from '$server/books/manifest';
import { serveChapter } from '$server/books/chapter';
import type { RequestHandler } from './$types';

/**
 * A chapter or asset of an HTML book (an EPUB or a saved site), for the
 * reader's sandboxed frame. 404 for a bad id, a book that is not on the
 * shelf, a PDF, or a file that is not there. The 404 is a bare text response
 * rather than the app's error page, which would load the app into the frame.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const { shelf } = await hub();
	const manifest = isBookId(params.id) ? await readManifest(shelf, params.id) : null;
	const response = manifest && manifest.format !== 'pdf' ? await serveChapter(shelf, manifest, params.path, request) : null;
	return response ?? new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
};

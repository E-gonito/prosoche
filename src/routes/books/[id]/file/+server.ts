import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isBookId } from '$server/books/id';
import { ORIGINAL, readManifest } from '$server/books/manifest';
import { fileResponse } from '$server/books/range';
import type { RequestHandler } from './$types';

/**
 * A book's original PDF, for the PDF reader. Honours one `Range` header
 * (`bytes=a-b` or `bytes=a-`) with 206 and `Content-Range`, so opening a
 * far page fetches only what it needs; a range past the end is 416. Without
 * a range, or with one it does not understand, the whole file with 200.
 * 404 for an id that is not valid, a book that is not on the shelf, or one
 * that is not a PDF. Streams from disk; never reads the file into memory.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const { shelf } = await hub();
	const manifest = isBookId(params.id) ? await readManifest(shelf, params.id) : null;
	if (!manifest || manifest.format !== 'pdf') error(404, 'That book is not here.');
	const response = await fileResponse(shelf, manifest.id, ORIGINAL.pdf, request, {
		'Content-Type': 'application/pdf',
		'Cache-Control': 'private, max-age=3600',
		'X-Content-Type-Options': 'nosniff'
	});
	if (!response) error(404, 'That book is not here.');
	return response;
};

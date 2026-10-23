import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isBookId } from '$server/books/id';
import { ORIGINAL, readManifest } from '$server/books/manifest';
import { parseRange } from '$server/books/range';
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

	// The size comes from opening the file for its first byte, then closing it.
	const probe = await shelf.stream(manifest.id, ORIGINAL.pdf, { start: 0, end: 0 });
	if (!probe) error(404, 'That book is not here.');
	await probe.body.cancel().catch(() => undefined);
	const { size } = probe;

	const asked = parseRange(request.headers.get('range'), size);
	const headers: Record<string, string> = {
		'content-type': 'application/pdf',
		'accept-ranges': 'bytes',
		'cache-control': 'private, max-age=3600',
		'x-content-type-options': 'nosniff'
	};
	if (asked.kind === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });

	const part = asked.kind === 'range' ? await shelf.stream(manifest.id, ORIGINAL.pdf, asked) : await shelf.stream(manifest.id, ORIGINAL.pdf);
	if (!part) error(404, 'That book is not here.');
	headers['content-length'] = String(size === 0 ? 0 : part.end - part.start + 1);
	if (asked.kind === 'range') {
		headers['content-range'] = `bytes ${part.start}-${part.end}/${size}`;
		return new Response(part.body, { status: 206, headers });
	}
	return new Response(part.body, { status: 200, headers });
};

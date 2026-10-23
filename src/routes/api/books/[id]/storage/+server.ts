import { json } from '@sveltejs/kit';
import { Shelf } from '$server/vault/shelf';
import { isBookId } from '$server/books/id';
import { readManifest } from '$server/books/manifest';
import { MAX_STORAGE_BYTES, checkStorage, writeStorage } from '$server/books/storage';
import type { RequestHandler } from './$types';

const shelf = new Shelf();

/**
 * `PUT { items }`: the `localStorage` of an HTML book's pages, as the reader
 * relays it from the chapter frame. Written whole. 404 for a book that is not
 * on the shelf or is a PDF, 415 for a body that is not JSON, 400 for items
 * that are not all strings, 413 for more than 2 MB.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isBookId(params.id)) return json({ ok: false, error: 'No such book.' }, { status: 404 });
	if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ ok: false, error: 'Send JSON.' }, { status: 415 });
	// Said before reading, so a body the server would refuse to hold is still answered as too large.
	if (Number(request.headers.get('content-length') ?? 0) > MAX_STORAGE_BYTES + 1024) return json({ ok: false, error: 'That is over 2 MB.' }, { status: 413 });
	const manifest = await readManifest(shelf, params.id);
	if (!manifest || manifest.format === 'pdf') return json({ ok: false, error: 'No such book.' }, { status: 404 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'That is not JSON.' }, { status: 400 });
	}
	const checked = checkStorage(body);
	if (!checked.ok) return checked.reason === 'too-large' ? json({ ok: false, error: 'That is over 2 MB.' }, { status: 413 }) : json({ ok: false, error: 'Send { items } with every value a string.' }, { status: 400 });
	await writeStorage(shelf, params.id, checked.items);
	return json({ ok: true });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { config } from '$server/config';
import { addSite, addUpload, listBooks, type Added } from '$server/books/library';
import { UPLOAD_TYPES } from '$lib/shared/books';
import { route, str } from '../route';
import type { RequestHandler } from './$types';

/** Every book that has a note, and the bytes free on the shelf's disk. */
export const GET: RequestHandler = route(async ({ hub: { vault, shelf } }) => ({ books: await listBooks(vault, shelf), free: await shelf.free() }));

const STATUS: Record<string, number> = {
	'bad-type': 415,
	'too-large': 413,
	'no-space': 507,
	'bad-pdf': 422,
	'bad-epub': 422,
	'not-a-book': 422,
	'bad-url': 400,
	unreachable: 502
};

const fail = (reason: string, error: string) => json({ ok: false, reason, error }, { status: STATUS[reason] ?? 422 });

/**
 * Add a book. Two kinds of request:
 *  - the file's own bytes, typed `application/pdf` or `application/epub+zip`,
 *    named by `?name=<file name>`: streamed to disk, never held in memory
 *    (and sent as raw bytes rather than a form, for the reason in
 *    `api/cute`);
 *  - JSON `{ url }`: a website saved as a copy; this can take a minute.
 *
 * Answers `{ ok: true, id, note, title, existing }`, or `{ ok: false,
 * reason, error }` with 415 (not a PDF or EPUB), 413 (too large), 507 (the
 * disk is too full), 422 (will not open, or the page is not a book), 400
 * (not a web address) or 502 (could not be fetched).
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	const { vault, shelf, index } = await hub();
	let added: Added;
	if (Object.hasOwn(UPLOAD_TYPES, type)) {
		if (Number(request.headers.get('content-length') ?? 0) > config.books.maxBytes) return fail('too-large', 'That file is too large for the server.');
		if (!request.body) return fail('invalid', 'Send the file itself.');
		added = await addUpload(vault, shelf, index, { type, name: url.searchParams.get('name') ?? '', body: request.body }, new Date());
	} else if (type === 'application/json') {
		const body: unknown = await request.json().catch(() => ({}));
		const address = str(body && typeof body === 'object' ? (body as { url?: unknown }).url : undefined);
		added = await addSite(vault, shelf, index, address ?? '', new Date());
	} else {
		return fail('bad-type', 'Send a PDF, an EPUB, or a web address.');
	}
	return added.ok ? json(added) : fail(added.reason, added.message);
};

import { getBook, removeBook, savePlace } from '$server/books/library';
import { parsePlace } from '$lib/shared/books';
import { refuse, route, str } from '../../route';
import type { RequestHandler } from './$types';

/** One book: `{ book, manifest, highlights }`, or 404 when it has no note. */
export const GET: RequestHandler = route(async ({ params, hub: { vault, shelf } }) => (await getBook(vault, shelf, params.id)) ?? refuse('not-found', 'There is no such book.'));

/**
 * Save the place: the body is `{ at }`, a place in the form `p. 412` or
 * `chapter.html#anchor`. Writes `at:` and `read_at:` in the book's note.
 */
export const PATCH: RequestHandler = route<{ at: string }>(async ({ body, params, hub: { vault } }) => {
	const place = parsePlace(str(body.at));
	if (!place) return refuse('invalid', 'That is not a place in a book.');
	return savePlace(vault, params.id, place, new Date());
});

/** Remove the book's files from the server. Its note, place and highlights stay. */
export const DELETE: RequestHandler = route(({ params, hub: { shelf, index } }) => removeBook(shelf, index, params.id));

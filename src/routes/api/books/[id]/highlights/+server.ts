import { addHighlight } from '$server/books/library';
import { parsePlace } from '$lib/shared/books';
import { refuse, route, str } from '../../../route';
import type { RequestHandler } from './$types';

/** Add a highlight to the book's note: `{ quote, at, comment? }`. Answers `{ ok: true, highlight }`. */
export const POST: RequestHandler = route<{ quote: string; at: string; comment: string }>(async ({ body, params, hub: { vault } }) => {
	const place = parsePlace(str(body.at));
	if (!place) return refuse('invalid', 'That is not a place in a book.');
	return addHighlight(vault, params.id, { quote: str(body.quote) ?? '', place, comment: str(body.comment) });
});

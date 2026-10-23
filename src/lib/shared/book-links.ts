/**
 * Where a book search hit leads: the reader, at the hit's place, with the
 * searched words to mark. Shared by every place that lists book hits (the
 * Notes search and the command palette) so they cannot disagree on the
 * address the reader expects.
 */

import { placeText, type Place } from './books';

/**
 * `/books/<id>?at=<place>&find=<query>`, both values URL-encoded. `query` is
 * what the person typed, trimmed. Pure.
 */
export function bookHitHref(hit: { book: string; place: Place }, query: string): string {
	return `/books/${hit.book}?at=${encodeURIComponent(placeText(hit.place))}&find=${encodeURIComponent(query.trim())}`;
}

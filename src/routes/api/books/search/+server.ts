import { searchBooks } from '$server/books/search';
import { route } from '../../route';

/**
 * `?q=&book=`: full-text search over the text of the books on the shelf, or
 * of one book. Answers `{ query, hits }`; an empty or unparsable query is no
 * hits, not an error.
 */
export const GET = route(async ({ url, hub }) => {
	const query = url.searchParams.get('q') ?? '';
	const book = url.searchParams.get('book') || undefined;
	return { query, hits: await searchBooks(hub.index, hub.shelf, query, { book }) };
});

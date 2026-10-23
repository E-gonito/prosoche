import { searchBooks } from '$server/books/search';
import { route } from '../route';

/**
 * `?q=`: full-text search over the notes, and over the text of the books.
 * Answers `{ query, hits, books }`: `hits` are notes, as they always were,
 * and `books` are hits inside books (`BookHit`), shown as their own group.
 */
export const GET = route(async ({ url, hub }) => {
	const query = url.searchParams.get('q') ?? '';
	return { query, hits: hub.index.search(query), books: await searchBooks(hub.index, hub.shelf, query, { limit: 20 }) };
});

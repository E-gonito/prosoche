import { paletteSearch } from '$server/palette';
import { searchBooks } from '$server/books/search';
import { route } from '../route';

/**
 * `?q=`: everything the command palette can find in the vault (see
 * `paletteSearch`), and under `books` the few best hits inside books.
 */
export const GET = route(async ({ url, hub }) => {
	const query = url.searchParams.get('q') ?? '';
	const vault = paletteSearch(hub.index, await hub.workspaces(), query);
	return { ...vault, books: await searchBooks(hub.index, hub.shelf, query, { limit: 5 }) };
});

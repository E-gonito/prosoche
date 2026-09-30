import { route } from '../route';

/** `?q=`: full-text search over the notes. Answers `{ query, hits }`. */
export const GET = route(({ url, hub }) => {
	const query = url.searchParams.get('q') ?? '';
	return { query, hits: hub.index.search(query) };
});

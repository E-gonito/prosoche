import { refuse, route } from '../../route';

/** `?path=`: both versions of a conflicted file, for the side-by-side view. */
export const GET = route(async ({ url, hub }) => {
	const path = url.searchParams.get('path');
	if (!path) return refuse('invalid', 'path is required');
	return (await hub.vault.sync.conflictDetail(path)) ?? refuse('not-found', 'No such conflict');
});

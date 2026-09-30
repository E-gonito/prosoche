import { refuse, route } from '../../route';

/** `?path=`: the unified diff for one pending file, so a change can be read before it is committed or thrown away. */
export const GET = route(async ({ url, hub }) => {
	const path = url.searchParams.get('path');
	return path ? { path, diff: await hub.vault.sync.diff(path) } : refuse('invalid', 'path is required');
});

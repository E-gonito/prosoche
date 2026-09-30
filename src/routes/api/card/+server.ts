import { cardContext } from '$server/tasks';
import { refuse, route } from '../route';

/**
 * `?path=&line=`: one task with its context for the card drawer (see
 * `cardContext`). A missing note or task is a 404 with a sentence to show.
 */
export const GET = route(async ({ url, hub }) => {
	const path = url.searchParams.get('path');
	const line = Number(url.searchParams.get('line'));
	if (!path || !Number.isInteger(line) || line < 0) return refuse('invalid', 'path and line are required');
	return cardContext(hub.vault, hub.index, await hub.workspaces(), path, line);
});

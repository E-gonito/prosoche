import { saveTypeNote } from '$server/dating';
import { refuse, route } from '../../route';

/** Save the type note whole: `{ content, expectedHash }` (see `saveTypeNote`). */
export const PUT = route(async ({ body, hub }) => {
	if (typeof body.content !== 'string' || typeof body.expectedHash !== 'string') return refuse('invalid', 'content and expectedHash are required');
	return saveTypeNote(hub.vault, body.content, body.expectedHash);
});

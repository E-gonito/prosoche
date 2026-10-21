import { draftSuggestions } from '$server/ai/tactics-drafts';
import { refuse, route } from '../../route';

/**
 * Draft suggestions for one draft scenario, `{ id }`. Answers a `DraftResult`
 * for `/api/ai/proposal`. Never writes a note.
 */
export const POST = route(async ({ body, hub }) =>
	typeof body.id === 'string' ? draftSuggestions(hub.vault, body.id) : refuse('invalid', 'id is required')
);

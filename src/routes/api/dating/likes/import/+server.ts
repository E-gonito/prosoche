import { importLikes } from '$server/dating';
import { route } from '../../../route';

/**
 * Import likes: `{ data }`, the parsed contents of an export file, in this
 * app's shape or the old one. Answers `{ created, updated, unchanged,
 * problems }`; never deletes.
 */
export const POST = route(async ({ body, hub }) => importLikes(hub.vault, body.data), {
	invalid: 'That file does not hold a list of likes.'
});

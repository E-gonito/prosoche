import { isMarkdown } from '$server/vault/paths';
import { refuse, route, str } from '../route';

/**
 * Save a whole note: `{ path, content, expectedHash }`, the hash the editor
 * was opened with. Answers `{ hash }`. A mismatch is a 409 carrying `current`
 * and `currentHash`, the other version, so the page can offer a merge
 * instead of silently overwriting the other device.
 */
export const PUT = route(async ({ body, hub }) => {
	const path = str(body.path);
	const content = str(body.content);
	if (!path || content === undefined) return refuse('invalid', 'path and content are required');
	if (!isMarkdown(path)) return refuse('invalid', 'Not a note this app will write');
	const result = await hub.vault.write(path, content, str(body.expectedHash));
	if (result.ok) return { hash: result.note.hash };
	return { ...refuse('conflict'), current: result.current.content, currentHash: result.current.hash };
});

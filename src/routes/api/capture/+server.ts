import { capture, CAPTURE_PATH } from '$server/capture';
import { homeFolder } from '$server/workspaces';
import { noWorkspace, refuse, route, str } from '../route';

/**
 * Capture `{ text }` into the vault-wide inbox, or into one workspace's own
 * with `workspace` (a slug). Answers `{ path }`, the note written. An unknown
 * workspace is refused rather than falling through to the vault-wide inbox,
 * so a typo never lands where the user did not point it.
 */
export const POST = route<{ text: string; workspace: string }>(async ({ body, hub }) => {
	const text = str(body.text);
	if (!text?.trim()) return refuse('no-text', 'Nothing to capture.');
	let path = CAPTURE_PATH;
	if (body.workspace) {
		const found = await hub.workspace(body.workspace);
		if (!found) return noWorkspace(body.workspace);
		path = `${homeFolder(found)}/Inbox.md`;
	}
	return { path: await capture(hub.vault, text, new Date(), path) };
});

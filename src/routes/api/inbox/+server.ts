import { fileInboxLine } from '$server/inbox';
import { noWorkspace, refuse, route, str } from '../route';

/**
 * "Make it a task": file one inbox line as a card on the workspace's board,
 * and mark the inbox line itself done. `{ workspace, line, expectedRaw }`;
 * `expectedRaw` guards the write the same way `/api/task` does, so a stale
 * line cannot file the wrong words. Answers `{ path }`.
 */
export const POST = route(
	async ({ body, hub }) => {
		const expectedRaw = str(body.expectedRaw);
		if (!body.workspace || typeof body.line !== 'number' || expectedRaw === undefined) {
			return refuse('invalid', 'workspace, line and expectedRaw are required');
		}
		const workspace = await hub.workspace(body.workspace);
		return workspace ? fileInboxLine(hub.vault, workspace, body.line, expectedRaw) : noWorkspace(body.workspace);
	},
	{ 'no-note': 'There is no inbox note to file from.', 'no-text': 'That line has no words to file.' }
);

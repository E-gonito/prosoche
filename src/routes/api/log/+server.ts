import { homeFolder } from '$server/workspaces';
import { addLogUpdate } from '$server/log';
import { noWorkspace, refuse, route, str } from '../route';

/** Append one bullet under today's heading in a workspace's Log.md: `{ workspace, text }`. Answers `{ path }`. */
export const POST = route(async ({ body, hub }) => {
	const text = str(body.text);
	if (!text?.trim()) return refuse('no-text', 'An update needs some words.');
	const workspace = await hub.workspace(body.workspace);
	if (!workspace) return noWorkspace(body.workspace);
	const path = `${homeFolder(workspace)}/Log.md`;
	return (await addLogUpdate(hub.vault, path, text)) ? { path } : refuse('conflict');
});

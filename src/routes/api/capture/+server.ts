import { capture } from '$server/capture';
import { noWorkspace, refuse, route, str } from '../route';

/**
 * Capture `{ text }`, wherever its words send it (see `capture.ts`), or
 * with `workspace` (a slug) into the inbox tagged for that workspace.
 * Answers `{ path, to, message }`: the file written, which of the three
 * places it was, and the sentence to show. An unknown workspace is refused
 * rather than dropped untagged, so a typo never lands where the user did not
 * point it.
 */
export const POST = route<{ text: string; workspace: string }>(async ({ body, hub }) => {
	const text = str(body.text);
	if (!text?.trim()) return refuse('no-text', 'Nothing to capture.');
	const workspace = body.workspace ? await hub.workspace(body.workspace) : undefined;
	if (body.workspace && !workspace) return noWorkspace(body.workspace);
	return capture(hub.vault, await hub.workspaces(), text, { workspace: workspace ?? undefined });
});

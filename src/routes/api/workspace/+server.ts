import { createWorkspace, deleteWorkspace, editWorkspace } from '$server/workspaces';
import { noWorkspace, route, str, strings } from '../route';

/** Folders as a list, or as the comma-separated string the wizard collects. */
function folders(value: unknown): string[] {
	return (strings(value) ?? (str(value) ?? '').split(',')).map((folder) => folder.trim()).filter(Boolean);
}

/**
 * Create a workspace definition file: `{ name, color, folders }`. Answers
 * `{ workspace }`. A taken slug is a 409 with a sentence, so the wizard can
 * show it beside the name field. Nothing is overwritten.
 */
export const POST = route(
	async ({ body, hub }) => createWorkspace(hub.vault, { name: str(body.name) ?? '', color: str(body.color), folders: folders(body.folders) }),
	{ 'no-name': 'A workspace needs a name.', exists: 'A workspace file with that name already exists. Pick a different name.' }
);

/**
 * Edit a workspace's definition, `{ slug, name?, color?, tag?,
 * description?, folders? }`: each field sent is written, and a field left
 * out is left alone (see `editWorkspace`). `folders` is every folder wanted
 * after the home. Answers `{ folders }`, the workspace's folders as now
 * written, home first.
 */
export const PATCH = route(async ({ body, hub }) => {
	const workspace = await hub.workspace(body.slug);
	if (!workspace) return noWorkspace(body.slug);
	const result = await editWorkspace(hub.vault, workspace, {
		name: str(body.name),
		color: str(body.color),
		tag: str(body.tag),
		description: str(body.description),
		folders: strings(body.folders)
	});
	return result.ok ? { folders: (await hub.workspace(workspace.slug))?.folders ?? [] } : result;
});

/**
 * Delete a workspace's definition file, `{ slug }`. Its notes and folders are
 * untouched (see `deleteWorkspace`).
 */
export const DELETE = route(async ({ body, hub }) => {
	const result = await deleteWorkspace(hub.vault, str(body.slug) ?? '');
	return result.ok ? result : noWorkspace(body.slug);
});

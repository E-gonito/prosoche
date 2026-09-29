import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { createWorkspace, deleteWorkspace, setReferenceFolders } from '$server/workspaces';
import type { RequestHandler } from './$types';

interface Body {
	name?: string;
	color?: string;
	/** Folders as a list, or as the comma-separated string the wizard collects. */
	folders?: string[] | string;
}

/**
 * Create a workspace definition file.
 *
 * A taken slug comes back as 409 with a sentence, so the wizard can show it
 * beside the name field instead of navigating away from a half-filled form.
 * Nothing here throws, and nothing is overwritten.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready } = hub();
	await ready;

	const result = await createWorkspace(vault, {
		name: body.name ?? '',
		color: body.color,
		folders: folders(body.folders)
	});

	if (!result.ok) {
		const error =
			result.reason === 'no-name'
				? 'A workspace needs a name.'
				: 'A workspace file with that name already exists. Pick a different name.';
		return json({ error }, { status: result.reason === 'no-name' ? 400 : 409 });
	}

	const { slug, name, color, tag, folders: chosen, path } = result.workspace;
	return json({ ok: true, workspace: { slug, name, color, tag, folders: chosen, path } }, { status: 201 });
};

/**
 * Set a workspace's reference folders, `{ slug, folders }` in the body, where
 * `folders` is every folder wanted after the home (see `setReferenceFolders`).
 * Answers with the folders as now written: 404 for an unknown slug, 400 for a
 * path it refuses, 409 when the file changed underneath, each with a sentence.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { slug?: unknown; folders?: unknown };
	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === body.slug);
	if (!workspace) return json({ error: 'There is no workspace by that name.' }, { status: 404 });
	const refs = Array.isArray(body.folders) ? body.folders.filter((f): f is string => typeof f === 'string') : [];
	const result = await setReferenceFolders(vault, workspace, refs);
	if (!result.ok) return json({ error: result.message }, { status: result.reason === 'invalid' ? 400 : result.reason === 'conflict' ? 409 : 404 });
	const now = (await workspaces()).find((w) => w.slug === workspace.slug);
	return json({ ok: true, folders: now?.folders ?? [] });
};

/**
 * Delete a workspace's definition file, `{ slug }` in the body. Its notes and
 * folders are untouched (see `deleteWorkspace`). 404 for an unknown slug.
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { slug?: unknown };
	const { vault, ready } = hub();
	await ready;
	const result = await deleteWorkspace(vault, typeof body.slug === 'string' ? body.slug : '');
	if (!result.ok) return json({ error: 'There is no workspace by that name.' }, { status: 404 });
	return json({ ok: true });
};

function folders(value: Body['folders']): string[] {
	const list = Array.isArray(value) ? value : (value ?? '').split(',');
	return list.map((folder) => folder.trim()).filter(Boolean);
}

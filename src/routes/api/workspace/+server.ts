import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { createWorkspace } from '$server/workspaces';
import type { RequestHandler } from './$types';

interface Body {
	name?: string;
	color?: string;
	/** Folders as a list, or as the comma-separated string the wizard collects. */
	folders?: string[] | string;
	template?: string;
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
		folders: folders(body.folders),
		template: body.template
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

function folders(value: Body['folders']): string[] {
	const list = Array.isArray(value) ? value : (value ?? '').split(',');
	return list.map((folder) => folder.trim()).filter(Boolean);
}

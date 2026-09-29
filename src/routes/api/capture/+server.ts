import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { capture, CAPTURE_PATH } from '$server/capture';
import { homeFolder } from '$server/workspaces';
import type { RequestHandler } from './$types';

/**
 * Capture a line, into the vault-wide inbox or one workspace's own.
 *
 * `workspace`, when given, is a slug: an unknown one is a 400 rather than a
 * silent fall-through to the vault-wide inbox, so a typo in the workspace
 * page's own request never lands where the user did not point it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { text, workspace } = (await request.json()) as { text?: string; workspace?: string };
	if (!text?.trim()) return json({ error: 'Nothing to capture' }, { status: 400 });

	const { vault } = hub();
	let path = CAPTURE_PATH;
	if (workspace) {
		const found = (await hub().workspaces()).find((w) => w.slug === workspace);
		if (!found) return json({ error: `There is no workspace called "${workspace}".` }, { status: 400 });
		path = `${homeFolder(found)}/Inbox.md`;
	}

	return json({ ok: true, path: await capture(vault, text, new Date(), path) });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { addLogUpdate } from '$server/log';
import type { RequestHandler } from './$types';

/** Append one bullet under today's heading in a workspace's Log.md. */
export const POST: RequestHandler = async ({ request }) => {
	const { workspace: slug, text } = (await request.json().catch(() => ({}))) as { workspace?: string; text?: string };
	if (!slug) return json({ error: 'Which workspace is this update for?' }, { status: 400 });
	if (!text?.trim()) return json({ error: 'An update needs some words.' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === slug);
	if (!workspace) return json({ error: `There is no workspace called "${slug}".` }, { status: 404 });

	const path = `${homeFolder(workspace)}/Log.md`;
	const ok = await addLogUpdate(vault, path, text);
	if (!ok) return json({ error: `${workspace.name}'s log changed on another device. Nothing was written; try again.` }, { status: 409 });
	return json({ ok: true, path });
};

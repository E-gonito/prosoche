import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { readLog } from '$server/log';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const workspace = (await workspaces()).find((w) => w.slug === params.slug)!;
	const path = `${homeFolder(workspace)}/Log.md`;
	const note = await vault.read(path);

	return { path, entries: readLog(note.content) };
};

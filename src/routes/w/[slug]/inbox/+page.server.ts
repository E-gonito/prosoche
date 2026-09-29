import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { listInboxLines } from '$server/inbox';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { vault, ready, workspaces } = hub();
	await ready;

	const workspace = (await workspaces()).find((w) => w.slug === params.slug)!;
	const home = homeFolder(workspace);
	const path = `${home}/Inbox.md`;
	const inbox = await vault.read(path);

	return {
		path,
		tasksPath: `${home}/Tasks.md`,
		lines: listInboxLines(inbox.content, path)
	};
};

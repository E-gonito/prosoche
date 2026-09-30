import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { openCards } from '$server/kanban';
import { belongsTo, legacyInbox, readInbox, unfiled } from '$server/inbox';
import { readLog } from '$server/log';
import { parseNote } from '$server/parse/note';
import type { PageServerLoad } from './$types';

/**
 * Every workspace, one row each: a glance at what needs attention before you
 * open one.
 */
export const load: PageServerLoad = async () => {
	const { vault, workspaces } = await hub();

	const defs = await workspaces();
	const cards = await openCards(vault, defs);
	const inbox = unfiled(await readInbox(vault));
	const rows = await Promise.all(
		defs.map(async (workspace) => {
			const home = homeFolder(workspace);
			const [note, legacy, log] = await Promise.all([vault.read(workspace.path), legacyInbox(vault, workspace), vault.read(`${home}/Log.md`)]);
			const description = parseNote(note.content, workspace.path)
				.body.split('\n')
				.map((l) => l.trim())
				.find((l) => l && !l.startsWith('#'));

			return {
				slug: workspace.slug,
				name: workspace.name,
				color: workspace.color,
				description: description ?? '',
				openTasks: cards.filter((c) => c.workspace.slug === workspace.slug).length,
				inboxCount: inbox.filter((l) => belongsTo(l, defs, workspace)).length + legacy.lines.length,
				latestLog: readLog(log.content)[0]?.day ?? null
			};
		})
	);

	return { workspaces: rows };
};

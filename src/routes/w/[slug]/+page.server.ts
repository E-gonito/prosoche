import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { readBoard } from '$server/kanban';
import { basename, parseNote } from '$server/parse/note';
import { renderNote } from '$server/render';
import { today } from '$server/daily';
import { relativeDay } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/** How many of each list the overview shows before "see all" is the better tool. */
const LIMIT = 6;

/**
 * A workspace's overview: its board, its master note, the notes that changed
 * most recently, and every folder in the vault, to offer when pointing the
 * workspace at another. What has come in and the latest log entry are the
 * layout's.
 *
 * The master note is `<home>/Overview.md`, sent both as its raw bytes, for
 * the editor, and rendered, for reading; a missing one is empty with
 * `exists: false`, and the first save creates it.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, workspace: find } = await hub();
	const workspace = (await find(params.slug))!;

	const overviewPath = `${homeFolder(workspace)}/Overview.md`;
	const [board, overview, vaultFolders] = await Promise.all([readBoard(vault, workspace), vault.read(overviewPath), vault.folders()]);

	const day = today();
	const notes = index
		.notes({ under: workspace.folders, limit: LIMIT })
		.map((note) => ({
			path: note.path,
			title: note.title || basename(note.path),
			day: relativeDay(today(new Date(note.mtimeMs)), day)
		}));

	return {
		board,
		today: day,
		overview: {
			path: overviewPath,
			exists: overview.exists,
			raw: overview.content,
			hash: overview.hash,
			html: overview.content.trim()
? renderNote(index, parseNote(overview.content, overviewPath).body) : ''
		},
		notes,
		vaultFolders
	};
};

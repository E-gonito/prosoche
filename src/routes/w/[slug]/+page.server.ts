import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { readBoard } from '$server/kanban';
import { readLog } from '$server/log';
import { basename, parseNote } from '$server/parse/note';
import { renderMarkdown } from '$server/render';
import { today } from '$server/daily';
import { noteHref, relativeDay } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/** How many of each list the overview shows before "see all" is the better tool. */
const LIMIT = 6;

/**
 * A workspace's overview: its board, its master note, what has come in, the
 * latest log entry, and the notes that changed most recently.
 *
 * The master note is `<home>/Overview.md`, sent both as its raw bytes, for
 * the editor, and rendered, for reading; a missing one is empty with
 * `exists: false`, and the first save creates it.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const workspace = defs.find((w) => w.slug === params.slug)!;
	const home = homeFolder(workspace);

	const overviewPath = `${home}/Overview.md`;
	const [board, overview, inbox, log] = await Promise.all([
		readBoard(vault, workspace),
		vault.read(overviewPath),
		vault.read(`${home}/Inbox.md`),
		vault.read(`${home}/Log.md`)
	]);

	const inboxPreview = inbox.content
		.split('\n')
		.filter((line) => /^[ \t]*[-*+][ \t]+/.test(line))
		.slice(-LIMIT)
		.reverse();

	const latestLog = readLog(log.content)[0] ?? null;

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
				? renderMarkdown(parseNote(overview.content, overviewPath).body, (target) => {
						const found = index.resolveLink(target);
						return found ? noteHref(found) : null;
					})
				: ''
		},
		inboxPreview,
		latestLog,
		notes,
		// Only a workspace with meetings has a notebook to link to.
		meetingsHref: workspace.meetings ? `/meetings/${workspace.slug}` : null
	};
};

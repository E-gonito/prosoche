import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { buildBoard, compareTasks } from '$server/board';
import { readLog } from '$server/log';
import { basename } from '$server/parse/note';
import { today } from '$server/daily';
import { relativeDay } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/** How many of each list the overview shows before "see all" is the better tool. */
const LIMIT = 6;

/**
 * A workspace's overview: the next things to do, what has come in, the
 * latest log entry, anything stuck waiting on something else, and the notes
 * that changed most recently.
 *
 * Every figure here is the same one its own tab would compute — next actions
 * are `openCards` sorted the way a board sorts them, blockers are read off
 * the board model rather than a second query — so the overview can never say
 * something its own tabs would disagree with.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const workspace = defs.find((w) => w.slug === params.slug)!;
	const home = homeFolder(workspace);

	const board = buildBoard(index, workspace, defs);
	const nextActions = board.columns
		.flatMap((c) => c.cards)
		.filter((c) => c.task.status === 'todo' || c.task.status === 'in-progress' || c.task.status === 'blocked')
		.sort((a, b) => compareTasks(a.task, b.task))
		.slice(0, LIMIT)
		.map((c) => c.task);

	const blocked = board.columns
		.flatMap((c) => c.cards)
		.filter((c) => c.blockers.length > 0)
		.slice(0, LIMIT);

	const inbox = await vault.read(`${home}/Inbox.md`);
	const inboxPreview = inbox.content
		.split('\n')
		.filter((line) => /^[ \t]*[-*+][ \t]+/.test(line))
		.slice(-LIMIT)
		.reverse();

	const log = await vault.read(`${home}/Log.md`);
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
		nextActions,
		blocked,
		inboxPreview,
		latestLog,
		notes,
		// Only a workspace with meetings has a notebook to link to.
		meetingsHref: workspace.meetings ? `/meetings/${workspace.slug}` : null
	};
};

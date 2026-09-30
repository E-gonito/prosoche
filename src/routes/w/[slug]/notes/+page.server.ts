import { hub } from '$server/hub';
import { basename } from '$server/parse/note';
import { today } from '$server/daily';
import { relativeDay } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = async ({ params }) => {
	const { index, workspace: find } = await hub();
	const workspace = (await find(params.slug))!;
	const day = today();
	const notes = index.notes({ under: workspace.folders, limit: LIMIT }).map((note) => ({
		path: note.path,
		title: note.title || basename(note.path),
		folder: note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '',
		day: relativeDay(today(new Date(note.mtimeMs)), day)
	}));

	return { notes, total: index.notesCount({ under: workspace.folders }) };
};

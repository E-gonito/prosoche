import { hub } from '$server/hub';
import { config } from '$server/config';
import { basename } from '$server/parse/note';
import { today } from '$server/daily';
import type { PageServerLoad } from './$types';

/** A glance. More than this and the tree is the better tool. */
const RECENT = 12;

export const load: PageServerLoad = async () => {
	const { vault, index } = await hub();

	const recent = index.notes({ excludePrefixes: [`${config.hubFolder}/`], limit: RECENT }).map((note) => ({
		path: note.path,
		title: note.title || basename(note.path),
		folder: note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '',
		// A day label rather than an instant, so server and browser agree.
		day: today(new Date(note.mtimeMs))
	}));

	return { tree: await vault.tree(), notes: index.health().notes, recent, today: today() };
};

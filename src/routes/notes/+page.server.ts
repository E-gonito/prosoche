import { hub } from '$server/hub';
import { config } from '$server/config';
import { dailyNotePath, today } from '$server/daily';
import { basename } from '$server/parse/note';
import type { PageServerLoad } from './$types';

/** Ten is a glance. More than that and the tree is the better tool. */
const RECENT = 10;

export const load: PageServerLoad = async () => {
	const { vault, index, ready } = hub();
	await ready;

	// The index already holds every note's title and modification time, so the
	// recent list costs one query rather than a walk over the vault.
	const day = today();
	const recent = index.notes({ excludePrefixes: [`${config.hubFolder}/`], limit: RECENT }).map((note) => ({
		path: note.path,
		title: note.title || basename(note.path),
		folder: note.path.includes('/') ? note.path.slice(0, note.path.lastIndexOf('/')) : '',
		// A day label rather than an instant: the page says "3 days ago", and
		// the server and the browser have to agree on what day it is.
		day: today(new Date(note.mtimeMs))
	}));

	return { tree: await vault.tree(), health: index.health(), recent, today: day, todayNote: dailyNotePath(day) };
};

import { hub } from '$server/hub';
import { today } from '$server/daily';
import { loadLikes, loadTypeNote } from '$server/dating';
import type { PageServerLoad } from './$types';

/** Every like, settled (see `loadLikes`), the type note and today, for the quick add and both lists. */
export const load: PageServerLoad = async () => {
	const { vault } = await hub();
	const day = today();
	const [likes, type] = await Promise.all([loadLikes(vault, day), loadTypeNote(vault)]);
	return { likes, type, today: day };
};

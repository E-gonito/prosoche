import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { loadToday } from '$server/today';
import type { PageServerLoad } from './$types';

/**
 * The evening review of one day: `/today/review` is the real today,
 * `/today/YYYY-MM-DD/review` any other. It reads exactly what Today reads,
 * through `loadToday`, so the tasks, their order, their workspaces and the
 * summary line are Today's own; the module cards are left out, because the
 * review shows none. Writes nothing: every tick is a `/api/task` call.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (params.day !== undefined && !isDayKey(params.day)) error(404, 'Not a date');
	const h = await hub();
	return loadToday({ vault: h.vault, index: h.index, workspaces: await h.workspaces() }, params.day ?? today());
};

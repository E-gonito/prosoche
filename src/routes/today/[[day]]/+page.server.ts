import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { loadToday } from '$server/today';
import { todayCards } from '$lib/modules/today.server';
import type { TodayData } from '$lib/shared/today';
import type { PageServerLoad } from './$types';

/**
 * A day's dashboard: `/today` is always the real today, `/today/YYYY-MM-DD`
 * any other day, from the vault as it stands right now. Anything else after
 * `/today/` is a 404. `loadToday` is the core reading; `todayCards` is what
 * every other module has to add, per its own contract in
 * `$lib/modules/today.server.ts`. Composed here rather than inside
 * `loadToday`, so the core never has to import the module layer above it.
 */
export const load: PageServerLoad = async ({ params }): Promise<TodayData> => {
	if (params.day !== undefined && !isDayKey(params.day)) error(404, 'Not a date');
	const day = params.day ?? today();
	const h = await hub();
	const [dashboard, cards] = await Promise.all([
		loadToday({ vault: h.vault, index: h.index, workspaces: await h.workspaces() }, day),
		todayCards({ day, hub: h })
	]);
	return { ...dashboard, cards };
};

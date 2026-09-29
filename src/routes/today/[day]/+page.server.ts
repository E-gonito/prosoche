import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey } from '$server/daily';
import { loadToday } from '$server/today';
import { todayCards } from '$lib/modules/today.server';
import type { TodayData } from '$lib/shared/today';
import type { PageServerLoad } from './$types';

/**
 * Any day's dashboard: today plus the surrounding week, from the vault as it
 * stands right now. `loadToday` is the core reading; `todayCards` is what
 * every other module has to add, per its own contract in
 * `$lib/modules/today.server.ts`. Composed here rather than inside
 * `loadToday`, so the core never has to import the module layer above it.
 */
export const load: PageServerLoad = async ({ params }): Promise<TodayData> => {
	if (!isDayKey(params.day)) error(404, 'Not a date');
	const h = hub();
	await h.ready;

	const [dashboard, cards] = await Promise.all([
		loadToday({ vault: h.vault, index: h.index, workspaces: await h.workspaces() }, params.day),
		todayCards({ day: params.day, hub: h })
	]);
	return { ...dashboard, cards };
};

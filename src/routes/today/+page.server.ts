import { hub } from '$server/hub';
import { today } from '$server/daily';
import { loadToday } from '$server/today';
import { todayCards } from '$lib/modules/today.server';
import type { TodayData } from '$lib/shared/today';
import type { PageServerLoad } from './$types';

/** `/today` is always the real today; `/today/[day]` is any other day. */
export const load: PageServerLoad = async (): Promise<TodayData> => {
	const h = hub();
	await h.ready;
	const day = today();

	const [dashboard, cards] = await Promise.all([
		loadToday({ vault: h.vault, index: h.index, workspaces: await h.workspaces() }, day),
		todayCards({ day, hub: h })
	]);
	return { ...dashboard, cards };
};

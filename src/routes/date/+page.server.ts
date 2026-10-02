import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { loadDay, loadTypeNote } from '$server/dating';
import type { PageServerLoad } from './$types';

/**
 * The Log tab: one day's counters, and the type note the quick add shows
 * beside "fits my type". `?day=` steps the stepper; a day past today is not
 * offered, the same rule the day stepper's own "next" arrow enforces on the
 * client.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault } = await hub();

	const requested = url.searchParams.get('day');
	const now = today();
	const day = requested && isDayKey(requested) && requested <= now ? requested : now;

	const [entry, type] = await Promise.all([loadDay(vault, day), loadTypeNote(vault)]);
	return { day, today: now, entry, typeHtml: type.html };
};

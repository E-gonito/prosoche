import { hub } from '$server/hub';
import { isDayKey, today } from '$server/daily';
import { loadDay } from '$server/dating';
import type { PageServerLoad } from './$types';

/**
 * The Log tab: one day's counters. `?day=` steps the stepper; a day past
 * today is not offered, the same rule the day stepper's own "next" arrow
 * enforces on the client.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault } = await hub();

	const requested = url.searchParams.get('day');
	const now = today();
	const day = requested && isDayKey(requested) && requested <= now ? requested : now;

	return { day, today: now, entry: await loadDay(vault, day) };
};

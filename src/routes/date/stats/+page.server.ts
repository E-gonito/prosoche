import { hub } from '$server/hub';
import { today } from '$server/daily';
import { bestDayOfWeek, loadLedger, rangeStats, weeklyTrend } from '$server/dating';
import type { PageServerLoad } from './$types';

const WEEKS = 12;

export const load: PageServerLoad = async () => {
	const { vault } = await hub();

	const { entries } = await loadLedger(vault);
	const day = today();

	return {
		ranges: {
			'7d': rangeStats(entries, '7d', day),
			'30d': rangeStats(entries, '30d', day),
			all: rangeStats(entries, 'all', day)
		},
		trend: weeklyTrend(entries, WEEKS, day),
		bestDay: bestDayOfWeek(entries)
	};
};

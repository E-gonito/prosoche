import { hub } from '$server/hub';
import { loadLedger } from '$server/dating';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault, ready } = hub();
	await ready;

	const { entries } = await loadLedger(vault);
	return { days: [...entries].sort((a, b) => b.day.localeCompare(a.day)) };
};

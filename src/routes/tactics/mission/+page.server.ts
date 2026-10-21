import { hub } from '$server/hub';
import { today } from '$server/daily';
import { planMission, viewOf } from '$server/tactics';
import { MODES, TACTICS, type Mode } from '$lib/shared/tactics';
import type { PageServerLoad } from './$types';

/**
 * One mission, chosen when the page loads: `?mode=` (ron, bodycam, shared
 * or aar-review; ron by default) and `&n=` drills (8 to 12), from every
 * scenario not retired. Reloading the page starts a new mission.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault, index } = await hub();
	const mode = (MODES.find((m) => m === url.searchParams.get('mode')) ?? 'ron') as Mode;
	const length = Number(url.searchParams.get('n')) || TACTICS.length.default;
	const plan = await planMission(vault, { mode, length }, today());
	return { mode, drills: plan.drills.map((s) => viewOf(s, index)), tags: plan.tags };
};

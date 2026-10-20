import { hub } from '$server/hub';
import { overview } from '$server/tactics';
import type { PageServerLoad } from './$types';

/**
 * The trainer's front page: what each mode could serve, the weakest tags,
 * and every scenario, including the ones that do not read and why.
 */
export const load: PageServerLoad = async () => {
	const { vault } = await hub();
	const { library, ...rest } = await overview(vault);
	return {
		...rest,
		scenarios: library.scenarios.map(({ id, game, drill, tags, status, provenance, difficulty, verifiedVersion }) => ({
			id,
			game,
			drill,
			tags,
			status,
			provenance,
			difficulty,
			verifiedVersion
		})),
		problems: library.problems
	};
};

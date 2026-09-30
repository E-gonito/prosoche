import { hub } from '$server/hub';
import { listDatingPeople, STAGES } from '$server/dating';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault } = await hub();

	return { people: await listDatingPeople(vault), stages: STAGES };
};

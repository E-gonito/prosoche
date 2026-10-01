import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

/**
 * The study subjects a line on this tab can go to the reading list of. The
 * lines themselves come from the workspace layout. Reads; never writes.
 */
export const load: PageServerLoad = async () => {
	const { subjects } = await hub();
	return { subjects: (await subjects()).map((s) => ({ slug: s.slug, name: s.name, color: s.color })) };
};

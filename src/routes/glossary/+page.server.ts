import { hub } from '$server/hub';
import { listGlossaries } from '$server/glossary';
import type { PageServerLoad } from './$types';

/** Every glossary in `Glossaries/`, with its size and the workspaces pointing at it. */
export const load: PageServerLoad = async () => {
	const { vault, workspaces } = await hub();
	return { glossaries: await listGlossaries(vault, await workspaces()) };
};

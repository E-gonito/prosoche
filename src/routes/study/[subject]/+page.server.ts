import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

/**
 * A subject at a glance. Everything but the folder picker's choices is the
 * layout's (`subjectView`); this adds every folder in the vault, to offer
 * beside the subject's own.
 */
export const load: PageServerLoad = async () => {
	const { vault } = await hub();
	return { vaultFolders: await vault.folders() };
};

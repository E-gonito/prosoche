import { hub } from '$server/hub';
import { glossariesFor } from '$server/glossary';
import type { PageServerLoad } from './$types';

/**
 * A subject at a glance. Everything but the folder picker's choices is the
 * layout's (`subjectView`); this adds every folder in the vault, to offer
 * beside the subject's own, and the glossaries whose terms become its cards.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { vault, workspaces } = await hub();
	const [vaultFolders, glossaries] = await Promise.all([vault.folders(), glossariesFor(vault, await workspaces(), params.subject)]);
	return { vaultFolders, glossaries };
};

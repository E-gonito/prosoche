import { hub } from '$server/hub';
import { notePaths, readSubjectNote, subjectTree } from '$server/study/notes';
import type { PageServerLoad } from './$types';

/**
 * A subject's Notes tab: the tree of its folders, and the note named by
 * `?note=` read in place. A `?note=` outside the subject's folders, or gone,
 * shows the tree with nothing open and says so. Every folder in the vault
 * comes too, for the folder editor to suggest.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
	const { subject } = await parent();
	const { vault, index } = await hub();

	const folders = subject.scope.folders ?? [];
	const tree = subjectTree(await vault.tree(), folders);
	const asked = url.searchParams.get('note');
	const note = asked ? await readSubjectNote(vault, index, folders, asked) : null;
	return {
		folders,
		tree,
		count: notePaths(tree).length,
		note,
		missing: asked !== null && note === null ? asked : null,
		vaultFolders: await vault.folders()
	};
};

import { hub } from '$server/hub';
import { notebookPaths, primerView } from '$server/meetings';
import { noteHref } from '$lib/shared/links';
import type { PageServerLoad } from './$types';

/** The meeting card: the workspace's `Primer.md`, cut into the card's shape. */
export const load: PageServerLoad = async ({ parent }) => {
	const { vault, index, workspaces } = hub();
	const { workspace } = await parent();
	const ws = (await workspaces()).find((w) => w.slug === workspace.slug)!;
	const paths = notebookPaths(ws);
	if (!paths) return { primer: null };

	const note = await vault.read(paths.primer);
	return {
		primer: {
			path: paths.primer,
			exists: note.exists && note.content.trim() !== '',
			sections: primerView(note.content, (t) => {
				const target = index.resolveLink(t);
				return target ? noteHref(target) : null;
			})
		}
	};
};

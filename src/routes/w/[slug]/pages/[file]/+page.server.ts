import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** One of the workspace's custom pages, by file name; the layout has listed them. */
export const load: PageServerLoad = async ({ params, parent }) => {
	const { file } = params;
	const { workspace, pages } = await parent();
	if (!pages.includes(file)) error(404, `${workspace.name} has no page called "${file}".`);
	return { file, title: file.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ') };
};

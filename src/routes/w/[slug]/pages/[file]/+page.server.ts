import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const { file } = params;
	if (!file || file.includes('/') || !/\.html?$/i.test(file)) error(404, 'No such page');

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === params.slug)!;

	const names = await vault.files(`${homeFolder(workspace)}/Pages`, 'html');
	if (!names.includes(file)) error(404, `${workspace.name} has no page called "${file}".`);

	return { file, title: file.replace(/\.html?$/i, '').replace(/[-_]+/g, ' ') };
};

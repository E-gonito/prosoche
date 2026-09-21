import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const { vault, index, ready } = hub();
	await ready;
	return { tree: await vault.tree(), health: index.health() };
};

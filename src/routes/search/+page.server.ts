import { hub } from '$server/hub';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';
	const { index, ready } = hub();
	await ready;
	return { query, hits: query.trim() ? index.search(query, 60) : [] };
};

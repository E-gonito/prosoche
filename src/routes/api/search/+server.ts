import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const { index, ready } = hub();
	await ready;
	const query = url.searchParams.get('q') ?? '';
	return json({ query, hits: index.search(query) });
};

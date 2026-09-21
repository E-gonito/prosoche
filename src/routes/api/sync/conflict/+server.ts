import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/** Both versions of a conflicted file, for the side-by-side view. */
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) return json({ error: 'path is required' }, { status: 400 });
	const detail = await hub().vault.sync.conflictDetail(path);
	return detail ? json(detail) : json({ error: 'No such conflict' }, { status: 404 });
};

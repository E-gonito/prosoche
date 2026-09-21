import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/** Unified diff for one pending file, so a change can be read before it is
 * committed or thrown away. */
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) return json({ error: 'path is required' }, { status: 400 });
	return json({ path, diff: await hub().vault.sync.diff(path) });
};

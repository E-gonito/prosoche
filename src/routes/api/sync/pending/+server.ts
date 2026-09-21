import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import type { RequestHandler } from './$types';

/** Local changes, for the commit and discard pickers. */
export const GET: RequestHandler = async () => {
	return json({ files: await hub().vault.sync.pending() });
};

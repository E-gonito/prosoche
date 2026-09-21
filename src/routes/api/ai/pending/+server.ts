import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { dequeue, pending } from '$server/ai/pending';
import type { RequestHandler } from './$types';

/**
 * The waiting queue. Applying is `POST /api/ai/proposal`; this only lists and
 * dismisses, so the one code path that writes stays in one place.
 */
export const GET: RequestHandler = async () => {
	const { vault, ready } = hub();
	await ready;
	return json({ pending: await pending(vault) });
};

export const POST: RequestHandler = async ({ request }) => {
	const { id } = (await request.json().catch(() => ({}))) as { action?: string; id?: string };
	if (!id) return json({ error: 'id is required' }, { status: 400 });
	const { vault, ready } = hub();
	await ready;
	return json({ removed: await dequeue(vault, id) });
};

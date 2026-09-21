import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { capture } from '$server/capture';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { text } = (await request.json()) as { text?: string };
	if (!text?.trim()) return json({ error: 'Nothing to capture' }, { status: 400 });
	return json({ ok: true, path: await capture(hub().vault, text) });
};

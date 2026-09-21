import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { loadSettings, saveSettings } from '$server/ai/settings';
import type { RequestHandler } from './$types';

/** The settings as they stand, for a page that wants them without a reload. */
export const GET: RequestHandler = async () => {
	const { vault, ready } = hub();
	await ready;
	return json({ settings: await loadSettings(vault) });
};

/**
 * Save the AI settings to `_hub/ai.md`.
 *
 * A human action, which is why it may write the one file every AI code path
 * is forbidden from touching. The body is run through the same parser a read
 * uses before anything is written, so a value the browser sent that is not in
 * the allowed set becomes the safe default rather than being stored.
 *
 * Responds with the settings as stored, which may differ from what was sent.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return json({ error: 'settings are required' }, { status: 400 });

	const { vault, ready } = hub();
	await ready;
	return json({ settings: await saveSettings(vault, body) });
};

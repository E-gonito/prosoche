import { saveSettings } from '$server/ai/settings';
import { refuse, route } from '../../route';

/**
 * Save the AI settings to `_hub/ai.md`; answers `{ settings }` as stored.
 *
 * A human action, which is why it may write the one file every AI code path
 * is forbidden from touching. The body is run through the same parser a read
 * uses before anything is written, so a value the browser sent that is not in
 * the allowed set becomes the safe default rather than being stored, and an
 * empty body is refused rather than saved as every default.
 */
export const POST = route(async ({ body, hub: { vault } }) =>
	Object.keys(body).length ? { settings: await saveSettings(vault, body) } : refuse('invalid', 'settings are required')
);

import { draftNewScenarios, readGenerateRequest } from '$server/ai/tactics-drafts';
import { today } from '$server/daily';
import { refuse, route } from '../../route';

/**
 * Draft new scenarios, `{ game, tags?, topic?, count? }`. Answers a
 * `DraftResult`, whose proposal goes to `/api/ai/proposal` to be validated
 * and applied. Never writes a note.
 */
export const POST = route(async ({ body, hub }) => {
	const request = readGenerateRequest(body);
	return request ? draftNewScenarios(hub.vault, request, today()) : refuse('invalid', 'Choose the game.');
});

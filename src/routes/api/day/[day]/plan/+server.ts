import { isDayKey } from '$server/daily';
import { addToDay } from '$server/day-plan';
import { refuse, route, str } from '../../../route';

/**
 * Plan a card from another note onto this day, as a linked block in the
 * day's note: `{ path, line, expectedRaw }`, the card and its line as the
 * client last saw it, and `startMin`/`endMin` for a time (both or neither).
 * Answers `{ task }`, the new block. A card that changed underneath is a 409
 * with the current line, which the client shows as a refresh.
 */
export const POST = route(
	async ({ params, body, hub }) => {
		if (!isDayKey(params.day)) return refuse('invalid', 'Not a date');
		const path = str(body.path);
		const expectedRaw = str(body.expectedRaw);
		if (!path || typeof body.line !== 'number' || expectedRaw === undefined) {
			return refuse('invalid', 'path, line and expectedRaw are required');
		}
		const time =
			typeof body.startMin === 'number' && typeof body.endMin === 'number' ? { startMin: body.startMin, endMin: body.endMin } : undefined;
		return addToDay(hub.vault, await hub.workspaces(), params.day, { path, line: body.line, expectedRaw }, time);
	},
	{ 'no-day': 'That day has no note yet. Create it on Today first.' }
);

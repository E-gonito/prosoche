import { isDayKey } from '$server/daily';
import { createDayNote } from '$server/day-plan';
import { refuse, route } from '../../../route';

/**
 * "Create today's note": make the day's note from the journal template.
 * No body. Answers `{ path, fromTemplate }`; a note already there is a 409
 * and is left exactly as it is.
 */
export const POST = route(
	async ({ params, hub }) => (isDayKey(params.day) ? createDayNote(hub.vault, params.day) : refuse('invalid', 'Not a date')),
	{ exists: 'That day already has a note, so nothing was written.' }
);

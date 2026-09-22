import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { isDayKey } from '$server/daily';
import { addToDay } from '$server/day-plan';
import type { RequestHandler } from './$types';

interface Body {
	/** The card's note, and where in it the card is. */
	path?: string;
	line?: number;
	/** That line as the client last saw it, for per-line conflict detection. */
	expectedRaw?: string;
	/** Minutes since midnight. Both or neither: a block with no time is fine. */
	startMin?: number;
	endMin?: number;
}

/**
 * Plan a card from another note onto this day, as a linked block in the day's
 * note. Responds 409 with the current line when the card changed underneath,
 * which the client shows as a refresh rather than an error.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!isDayKey(params.day)) return json({ error: 'Not a date' }, { status: 400 });

	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.path || typeof body.line !== 'number' || typeof body.expectedRaw !== 'string') {
		return json({ error: 'path, line and expectedRaw are required' }, { status: 400 });
	}
	const time =
		typeof body.startMin === 'number' && typeof body.endMin === 'number'
			? { startMin: body.startMin, endMin: body.endMin }
			: undefined;

	const { vault, workspaces } = hub();
	const card = { path: body.path, line: body.line, expectedRaw: body.expectedRaw };
	const result = await addToDay(vault, await workspaces(), params.day, card, time);

	if (result.ok) return json({ ok: true, task: result.task }, { status: 201 });
	if (result.reason === 'line-changed') return json(result, { status: 409 });
	return json(result, { status: result.reason === 'no-note' ? 404 : 422 });
};

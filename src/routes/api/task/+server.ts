import { updateTask } from '$server/tasks';
import type { TaskEdit } from '$server/parse/task';
import { refuse, route, str } from '../route';

/** Fields of the body that are simply passed to the rewriter, when present. */
const EDITS = ['status', 'time', 'quadrant', 'text', 'due', 'id', 'blockedBy', 'addTags', 'removeTags'] as const;

/**
 * Edit one task: `{ path, line, expectedRaw }`, the line as the client last
 * saw it, and any of `EDITS`. Answers `{ task }`. A line that changed
 * underneath is a 409 with `current`, which the client shows as a refresh.
 */
export const POST = route(async ({ body, hub }) => {
	const path = str(body.path);
	const expectedRaw = str(body.expectedRaw);
	if (!path || typeof body.line !== 'number' || expectedRaw === undefined) {
		return refuse('invalid', 'path, line and expectedRaw are required');
	}
	const edit = Object.fromEntries(EDITS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]])) as TaskEdit;
	return updateTask(hub.vault, path, body.line, expectedRaw, edit);
});

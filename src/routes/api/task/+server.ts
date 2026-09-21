import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { updateTask } from '$server/tasks';
import type { TaskStatus } from '$server/parse/task';
import type { RequestHandler } from './$types';

interface Body {
	path?: string;
	line?: number;
	/** The line as the client last saw it, for per-line conflict detection. */
	expectedRaw?: string;
	status?: TaskStatus;
	time?: { start: string; end: string } | null;
	quadrant?: number | null;
	text?: string;
	due?: string | null;
	id?: string | null;
	blockedBy?: string[] | null;
	addTags?: string[];
	removeTags?: string[];
}

/** Fields of the body that are simply passed to the rewriter, when present. */
const EDITS = ['status', 'time', 'quadrant', 'text', 'due', 'id', 'blockedBy', 'addTags', 'removeTags'] as const;

/**
 * Edit one task. Responds 409 with the current line when it changed
 * underneath, which the client shows as a refresh rather than an error.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	if (!body.path || typeof body.line !== 'number' || typeof body.expectedRaw !== 'string') {
		return json({ error: 'path, line and expectedRaw are required' }, { status: 400 });
	}

	const { vault } = hub();
	const edit = Object.fromEntries(EDITS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
	const result = await updateTask(vault, body.path, body.line, body.expectedRaw, edit);

	if (result.ok) return json({ ok: true, task: result.task });
	if (result.reason === 'line-changed') return json(result, { status: 409 });
	return json(result, { status: result.reason === 'no-note' ? 404 : 422 });
};

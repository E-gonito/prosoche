import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { changeBoard, type BoardOp } from '$server/kanban';
import type { RequestHandler } from './$types';

/**
 * Change a board: `{ workspace, hash, op }`, where `hash` is the board's hash
 * as the page last saw it. Answers with the board as it now is: 200 when the
 * op was applied, 409 when the file had changed first, 422 when the op made
 * no sense against it. The last two carry a sentence and write nothing.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { workspace?: string; hash?: string; op?: BoardOp };
	if (!body.workspace) return json({ error: 'Which workspace is this board for?' }, { status: 400 });
	if (typeof body.hash !== 'string' || !body.op) return json({ error: 'hash and op are required' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const result = await changeBoard(vault, workspace, body.hash, body.op);
	if (result.ok) return json({ board: result.board });
	if (result.reason === 'conflict') {
		return json({ error: `${workspace.name}'s board changed somewhere else. It has been reloaded; try again.`, board: result.board }, { status: 409 });
	}
	return json({ error: result.message, board: result.board }, { status: 422 });
};

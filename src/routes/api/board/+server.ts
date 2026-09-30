import { changeBoard } from '$server/kanban';
import type { BoardOp } from '$lib/shared/kanban';
import { noWorkspace, refuse, route } from '../route';

/**
 * Change a board: `{ workspace, hash, op }`, where `hash` is the board's hash
 * as the page last saw it. Every answer carries `board`, the board as it now
 * is: 200 when the op was applied, 409 when the file had changed first, and a
 * refusal with a sentence when the op made no sense. The last two write
 * nothing.
 */
export const POST = route<{ workspace: string; hash: string; op: BoardOp }>(
	async ({ body, hub }) => {
		if (typeof body.hash !== 'string' || !body.op) return refuse('invalid', 'hash and op are required');
		const workspace = await hub.workspace(body.workspace);
		return workspace ? changeBoard(hub.vault, workspace, body.hash, body.op) : noWorkspace(body.workspace);
	},
	{ conflict: 'The board changed somewhere else. It has been reloaded; try again.' }
);

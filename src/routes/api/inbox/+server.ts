import { dropInboxLine, fileInboxLine, noteInboxLine, planInboxLine } from '$server/inbox';
import { today } from '$server/daily';
import { noWorkspace, refuse, route, str } from '../route';

/**
 * One exit for one line of `Inbox/Capture.md`, which is then ticked in place:
 * `{ action, line, expectedRaw }` with `action` one of
 *
 *  - `plan`: a block with no time in today's note;
 *  - `file`: a card on the board of `workspace` (a slug);
 *  - `note`: a bullet at the end of that workspace's `Overview.md`;
 *  - `drop`: nothing else.
 *
 * `expectedRaw` guards the write the same way `/api/task` does, so a stale
 * line cannot act on the wrong words. Answers `{ path }`, the file the line
 * went to.
 */
export const POST = route(
	async ({ body, hub }) => {
		const expectedRaw = str(body.expectedRaw);
		const line = body.line;
		if (typeof line !== 'number' || expectedRaw === undefined) return refuse('invalid', 'line and expectedRaw are required');
		if (body.action === 'drop') return dropInboxLine(hub.vault, line, expectedRaw);
		if (body.action === 'plan') return planInboxLine(hub.vault, await hub.workspaces(), today(), line, expectedRaw);
		if (body.action !== 'file' && body.action !== 'note') return refuse('invalid', 'action is plan, file, note or drop');
		const workspace = await hub.workspace(body.workspace);
		if (!workspace) return noWorkspace(body.workspace);
		return body.action === 'file' ? fileInboxLine(hub.vault, workspace, line, expectedRaw) : noteInboxLine(hub.vault, workspace, line, expectedRaw);
	},
	{
		'no-note': 'There is no inbox to triage.',
		'no-text': 'That line has no words to file.',
		'no-day': 'Today has no note yet. Create it on Today first.'
	}
);

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { fileInboxLine } from '$server/inbox';
import type { RequestHandler } from './$types';

interface Body {
	workspace?: string;
	line?: number;
	expectedRaw?: string;
}

/**
 * "Make it a task": file one inbox line as a card on the workspace's board, and
 * mark the inbox line itself done. `expectedRaw` guards the write the same
 * way `/api/task` does, so a stale line from a page the user has not
 * refreshed cannot file the wrong words.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.workspace || typeof body.line !== 'number' || typeof body.expectedRaw !== 'string') {
		return json({ error: 'workspace, line and expectedRaw are required' }, { status: 400 });
	}

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const result = await fileInboxLine(vault, workspace, body.line, body.expectedRaw);

	if (result.ok) return json({ ok: true, path: result.path });
	const status = result.reason === 'no-note' ? 404 : result.reason === 'no-text' || result.reason === 'no-column' ? 400 : 409;
	return json({ error: MESSAGES[result.reason] }, { status });
};

const MESSAGES: Record<'no-note' | 'no-text' | 'line-changed' | 'no-column', string> = {
	'no-note': 'There is no inbox note to file from.',
	'no-text': 'That line has no words to file.',
	'no-column': 'The board has no column to file it into. Add one on the Overview.',
	'line-changed': 'That line changed on another device. Reloading.'
};

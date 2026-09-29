import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { addDeal, setDealStage } from '$server/deals';
import type { RequestHandler } from './$types';

interface NewDealBody {
	workspace?: string;
	text?: string;
	person?: string | null;
	stage?: string | null;
	value?: string | null;
	next?: string | null;
}

/** Append a deal to a workspace's pipeline. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as NewDealBody;
	if (!body.workspace) return json({ error: 'Which workspace is this deal for?' }, { status: 400 });

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const result = await addDeal(vault, workspace, {
		text: body.text ?? '',
		person: body.person,
		stage: body.stage,
		value: body.value,
		next: body.next
	});
	if (result.ok) return json({ ok: true, deal: result.deal }, { status: 201 });
	return json({ error: result.reason === 'no-text' ? 'A deal needs a name.' : `${workspace.name}'s pipeline changed on another device. Nothing was written; try again.` }, {
		status: result.reason === 'conflict' ? 409 : 400
	});
};

interface StageBody {
	workspace?: string;
	line?: number;
	expectedRaw?: string;
	stage?: string;
}

/**
 * Move one deal to a new stage. Responds 409 with the current line when it
 * changed underneath, the same conflict shape `/api/task` answers with.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as StageBody;
	if (!body.workspace || typeof body.line !== 'number' || typeof body.expectedRaw !== 'string' || !body.stage) {
		return json({ error: 'workspace, line, expectedRaw and stage are required' }, { status: 400 });
	}

	const { vault, ready, workspaces } = hub();
	await ready;
	const workspace = (await workspaces()).find((w) => w.slug === body.workspace);
	if (!workspace) return json({ error: `There is no workspace called "${body.workspace}".` }, { status: 404 });

	const result = await setDealStage(vault, workspace, body.line, body.expectedRaw, body.stage);
	if (result.ok) return json({ ok: true, deal: result.deal });
	if (result.reason === 'line-changed') return json(result, { status: 409 });
	return json(result, { status: result.reason === 'no-note' ? 404 : 422 });
};

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { ask } from '$server/ai/ask';
import { config } from '$server/config';
import type { RunSettings, Scope } from '$lib/shared/ai';
import type { RequestHandler } from './$types';

interface Body {
	question?: string;
	scope?: Scope;
	feature?: 'ask' | 'insights';
	override?: Partial<RunSettings>;
}

const SCOPES = ['vault', 'workspace', 'folder', 'note'];

/**
 * Ask a question about the vault. Read-only by construction: this endpoint
 * has no path that writes a note, and `ask` forces the permission mode to
 * `read-only` whatever the body says.
 *
 * Responds 200 with the answer, which may itself carry a `problem` and the
 * refusals when a guardrail stopped the run - a refusal is an answer, not an
 * error, and the page renders it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	if (typeof body.question !== 'string') return json({ error: 'question is required' }, { status: 400 });

	const scope = body.scope;
	if (!scope || !SCOPES.includes(scope.kind)) return json({ error: 'a valid scope is required' }, { status: 400 });

	const { vault, index, ready, workspaces } = hub();
	await ready;

	const conventions = (await vault.read('CLAUDE.md')).content || undefined;
	const answer = await ask(
		{ vault, index, workspaces: await workspaces() },
		{
			question: body.question,
			scope,
			feature: body.feature === 'insights' ? 'insights' : 'ask',
			// The settings row may narrow a run but not widen it: the mode is
			// dropped here so a crafted request cannot ask for tools.
			override: pickOverride(body.override),
			conventions
		}
	);
	return json({ answer, vaultFolder: config.hubFolder });
};

/** Only the fields a per-run row is allowed to change. Mode is never one. */
function pickOverride(override: Partial<RunSettings> | undefined): Partial<RunSettings> | undefined {
	if (!override) return undefined;
	const out: Partial<RunSettings> = {};
	if (override.model) out.model = override.model;
	if (override.effort) out.effort = override.effort;
	if (typeof override.budgetUsd === 'number') out.budgetUsd = override.budgetUsd;
	if (typeof override.timeoutSeconds === 'number') out.timeoutSeconds = override.timeoutSeconds;
	return out;
}

import { json } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { logRun } from '$server/ai/audit';
import { apply, policyFor, undo, validate } from '$server/ai/proposal';
import { loadSettings } from '$server/ai/settings';
import type { Proposal } from '$lib/shared/ai';
import type { RequestHandler } from './$types';

interface Body {
	action?: 'validate' | 'apply' | 'undo';
	proposal?: Proposal;
	/** Edit ids the user ticked. Ignored by `validate`. */
	accepted?: string[];
	undoId?: string;
	/** Paths this run named as its destination, for the per-feature allowlist. */
	destinations?: string[];
}

/**
 * Validate, apply or undo a proposal.
 *
 * The proposal comes back from the browser rather than being held on the
 * server between the two requests, which means it is untrusted input: a
 * tampered `accepted` list, an edited path, a forged feature. That is fine,
 * and deliberate - every one of those is something a guardrail already checks
 * on the way in, and re-validating here is cheaper than a session store that
 * would have to be invalidated when the vault changed underneath it.
 *
 * Responds 200 for a refusal as well as a success: which edits were written
 * and which guardrail stopped the rest is the answer, not an error.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const { vault, ready } = hub();
	await ready;

	if (body.action === 'undo') {
		if (!body.undoId) return json({ error: 'undoId is required' }, { status: 400 });
		return json({ undone: await undo(vault, body.undoId) });
	}

	const proposal = body.proposal;
	if (!proposal || !Array.isArray(proposal.edits) || typeof proposal.feature !== 'string') {
		return json({ error: 'a proposal is required' }, { status: 400 });
	}

	const settings = await loadSettings(vault);
	const policy = policyFor(proposal.feature, settings, { today: today(), destinations: body.destinations });

	if (body.action === 'apply') {
		const result = await apply(vault, proposal, policy, { accepted: body.accepted ?? proposal.accepted });
		await logRun(vault, {
			at: new Date().toISOString(),
			feature: proposal.feature,
			model: proposal.stamp.model,
			effort: proposal.stamp.effort,
			permission: proposal.stamp.permission,
			paths: result.written.length ? result.written : proposal.edits.map((e) => e.path),
			decision: result.written.length ? 'applied' : 'refused',
			guardrails: [...new Set(result.refusals.map((r) => r.guardrail))],
			costUsd: 0,
			durationMs: 0,
			note: result.written.length ? proposal.summary : (result.refusals[0]?.message ?? 'rejected')
		});
		return json({ result });
	}

	return json({ validation: await validate(vault, proposal, policy) });
};

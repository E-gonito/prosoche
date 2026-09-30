import { today } from '$server/daily';
import { apply, policyFor, undo, validate } from '$server/ai/proposal';
import { loadSettings } from '$server/ai/settings';
import type { Proposal } from '$lib/shared/ai';
import { refuse, route, strings } from '../../route';

interface Body {
	action: 'validate' | 'apply' | 'undo';
	proposal: Proposal;
	/** Edit ids the user ticked. Ignored by `validate`. */
	accepted: string[];
	undoId: string;
	/** Paths this run named as its destination, for the per-feature allowlist. */
	destinations: string[];
}

/**
 * Validate, apply or undo a proposal: answers `{ validation }`, `{ result }`
 * or `{ undone }`.
 *
 * The proposal comes back from the browser rather than being held on the
 * server between the two requests, which means it is untrusted input: a
 * tampered `accepted` list, an edited path, a forged feature. That is fine,
 * and deliberate - every one of those is something a guardrail already checks
 * on the way in, and re-validating here is cheaper than a session store that
 * would have to be invalidated when the vault changed underneath it.
 *
 * A guardrail's refusal is a 200: which edits were written and which
 * guardrail stopped the rest is the answer, not an error.
 */
export const POST = route<Body>(async ({ body, hub: { vault } }) => {
	if (body.action === 'undo') {
		return body.undoId ? { undone: await undo(vault, body.undoId) } : refuse('invalid', 'undoId is required');
	}
	const proposal = body.proposal;
	if (!proposal || !Array.isArray(proposal.edits) || typeof proposal.feature !== 'string') {
		return refuse('invalid', 'a proposal is required');
	}
	const policy = policyFor(proposal.feature, await loadSettings(vault), { today: today(), destinations: strings(body.destinations) });
	if (body.action === 'apply') return { result: await apply(vault, proposal, policy, { accepted: strings(body.accepted) }) };
	return { validation: await validate(vault, proposal, policy) };
});

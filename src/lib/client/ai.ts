/**
 * The browser's side of the AI endpoints.
 *
 * Same shape as `client/api.ts`: every call returns a discriminated result
 * rather than throwing, because a refusal is something to render, not an
 * exception to catch. A guardrail firing is a normal outcome here - arguably
 * the most important one - so it travels as data all the way to the screen.
 */

import type {
	AiSettings,
	Answer,
	ApplyResult,
	BriefingRun,
	Proposal,
	Refusal,
	RunSettings,
	Scope,
	Validation
} from '$lib/shared/ai';

export type AiResult<T> =
	| { ok: true; value: T }
	| { ok: false; kind: 'refused'; message: string; refusals: Refusal[] }
	| { ok: false; kind: 'offline' | 'error'; message: string };

/** Ask a question. Read-only: this can never write to the vault. */
export async function askQuestion(
	question: string,
	scope: Scope,
	feature: 'ask' | 'insights',
	override?: Partial<RunSettings>
): Promise<AiResult<Answer>> {
	return post('/api/ai/ask', { question, scope, feature, override }, (body) => body.answer as Answer);
}

/**
 * Re-run the guardrails over a proposal, without writing anything.
 *
 * `destinations` are the paths this particular run named, which the
 * per-feature path policy needs: `suggest-flashcards` may write the note it
 * read and nothing else, so the server has to be told which note that was.
 */
export async function checkProposal(proposal: Proposal, destinations: string[] = []): Promise<AiResult<Validation>> {
	return post(
		'/api/ai/proposal',
		{ action: 'validate', proposal, destinations },
		(body) => body.validation as Validation
	);
}

/** Write the edits the user ticked. Safe to call twice with the same proposal. */
export async function applyProposal(
	proposal: Proposal,
	accepted: string[],
	destinations: string[] = []
): Promise<AiResult<ApplyResult>> {
	return post(
		'/api/ai/proposal',
		{ action: 'apply', proposal, accepted, destinations },
		(body) => body.result as ApplyResult
	);
}

/** Put back what a proposal changed. */
export async function undoProposal(undoId: string): Promise<AiResult<{ restored: string[]; skipped: string[] }>> {
	return post('/api/ai/proposal', { action: 'undo', undoId }, (body) => body.undone);
}

/** Save the AI settings. Returns them as stored, after clamping. */
export async function saveAiSettings(settings: AiSettings): Promise<AiResult<AiSettings>> {
	return post('/api/ai/settings', settings, (body) => body.settings as AiSettings);
}

async function post<T>(url: string, body: unknown, pick: (body: any) => T): Promise<AiResult<T>> {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: pick(parsed) };
		if (Array.isArray(parsed.refusals) && parsed.refusals.length) {
			return { ok: false, kind: 'refused', message: parsed.refusals[0].message, refusals: parsed.refusals };
		}
		return { ok: false, kind: 'error', message: parsed.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection.' };
	}
}

/**
 * Regenerate today's briefing and get back what the note now says.
 *
 * Writes, under G1's one exception, so this is a POST. A run that could not
 * produce a sentence is still a success carrying a `problem`, because the
 * lists were written either way and the card shows both.
 */
export async function regenerateBriefing(day: string): Promise<AiResult<BriefingRun>> {
	return post('/api/ai/briefing', { day }, (body) => body.briefing as BriefingRun);
}

/**
 * Take a proposal out of the waiting queue without applying it.
 *
 * Also called after a successful apply, because the queue is "what is still
 * undecided" and an applied proposal is decided. Removing one that is not
 * there succeeds: two tabs deciding the same thing is normal.
 */
export async function dismissProposal(id: string): Promise<AiResult<{ removed: boolean }>> {
	return post('/api/ai/pending', { action: 'dismiss', id }, (body) => ({ removed: Boolean(body.removed) }));
}

/** A drafted change, with the paths `applyProposal` must be told about. */
export interface Drafted {
	proposal: Proposal | null;
	destinations: string[];
	problem: string | null;
	refusals: Refusal[];
	/** Set by the timesheet draft: the text to copy, whether or not it is saved. */
	text?: string;
	/** Set by capture: the notes it was offered, so an empty vault says why. */
	candidates?: string[];
	/** Set by suggest-flashcards: cards the note did not support. */
	unsupported?: Array<{ question: string; answer: string; quote: string }>;
}

/**
 * Ask one of the three drafting features for a proposal.
 *
 * Read-only on the way in: nothing is written until the proposal comes back
 * and `applyProposal` is called with the ids the user ticked. `destinations`
 * must be passed through to that call, because the path policy is per-run.
 */
export async function draftChange(request: {
	feature: 'capture' | 'suggest-flashcards' | 'timesheet';
	path?: string;
	line?: number;
	expectedRaw?: string;
	day?: string;
	count?: number;
}): Promise<AiResult<Drafted>> {
	return post('/api/ai/suggest', request, (body) => body as Drafted);
}

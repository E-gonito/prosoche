/**
 * The shared runner for the features that ask Claude for a JSON answer and
 * turn it into a proposal: the types every draft returns, the notes gathered
 * into a prompt, and `runDraft`, which does the checked, logged CLI run.
 * Nothing here writes to the vault.
 */

import type { Vault } from '../vault/index';
import { checkBudget, checkKillSwitch, validateModelOutput, type Schema } from './guardrails';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { FeatureId, GuardrailId, Proposal, Refusal, RunStamp } from '$lib/shared/ai';

/** What every draft returns: a proposal, or why there is none. */
export interface DraftResult {
	proposal: Proposal | null;
	problem: string | null;
	refusals: Refusal[];
	/** The one path the proposal may write, for the per-run path policy. */
	destinations: string[];
}

export interface DraftOptions {
	cli?: Partial<CliDeps>;
}

/** A passage of the user's notes, for `wrapAsData`. */
export interface Source {
	path: string;
	text: string;
}

/** How much of any one note goes into a prompt. */
export const NOTE_CHARS = 8000;

/* ------------------------------------------------------------- plumbing -- */

/** A draft result with no proposal, saying why (or null for "nothing to do"). Pure. */
export function nothing(problem: string | null): DraftResult {
	return { proposal: null, problem, refusals: [], destinations: [] };
}

/**
 * The notes that exist and are not blank among `paths`, each trimmed to its
 * last `NOTE_CHARS` for a prompt. Reads only; a missing note is skipped.
 */
export async function gather(vault: Vault, paths: string[]): Promise<Source[]> {
	const out: Source[] = [];
	for (const path of paths) {
		const note = await vault.read(path);
		if (note.exists && note.content.trim()) out.push({ path, text: note.content.slice(-NOTE_CHARS) });
	}
	return out;
}

/**
 * One read-only CLI run, checked and logged: kill switch (G10), budget (G7),
 * schema (G6). Returns the validated answer and the stamp, or the draft
 * result to hand back when there is none. Side effects: spawns the CLI with
 * the feature's model settings, appends to the audit log. Never writes a
 * note.
 */
export async function runDraft<T>(
	vault: Vault,
	input: { feature: FeatureId; prompt: string; system: string; schema: Schema; paths: string[]; cli?: Partial<CliDeps> }
): Promise<{ ok: true; value: T; stamp: RunStamp } | { ok: false; result: DraftResult }> {
	const settings = await loadSettings(vault);
	const chosen = settings.features[input.feature];
	const startedAt = new Date().toISOString();
	const fail = (problem: string, refusals: Refusal[]) => ({ ok: false as const, result: { ...nothing(problem), refusals } });

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return fail(stop[0].message, stop);

	const spend = await spentOn(vault, startedAt.slice(0, 10));
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	if (budget.refusals.length) return fail(budget.refusals[0].message, budget.refusals);

	const result = await runClaude(
		{ prompt: input.prompt, settings: { ...budget.settings, permission: 'read-only' }, systemPrompt: input.system, jsonSchema: input.schema },
		input.cli
	);
	const stamp: RunStamp = {
		...budget.settings,
		feature: input.feature,
		startedAt,
		durationMs: result.durationMs,
		costUsd: result.ok ? result.costUsd : 0
	};
	const log = (decision: 'proposed' | 'refused' | 'failed', note: string, guardrails: GuardrailId[] = []) =>
		logRun(vault, {
			at: startedAt,
			feature: input.feature,
			model: stamp.model,
			effort: stamp.effort,
			permission: stamp.permission,
			paths: input.paths,
			decision,
			guardrails,
			costUsd: stamp.costUsd,
			durationMs: stamp.durationMs,
			note
		});

	if (!result.ok) {
		await log(result.reason === 'refused' ? 'refused' : 'failed', result.message, result.refusals.map((r) => r.guardrail));
		return fail(result.message, result.refusals);
	}
	const checked = validateModelOutput<T>(result.json, input.schema);
	if (!checked.ok) {
		await log('refused', 'model output did not match the schema', ['G6']);
		return fail(checked.refusals[0].message, checked.refusals);
	}
	await log('proposed', `${input.feature} drafted`);
	return { ok: true, value: checked.value, stamp };
}

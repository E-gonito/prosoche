/**
 * The one runner every AI feature goes through: `runDraft`, which does the
 * checked, logged, read-only CLI run, plus the types a drafting feature
 * returns and the notes gathered into a prompt. Nothing here writes to the
 * vault.
 *
 * Designed twice. (a) One function, `runDraft(feature, prompt, schema?)`,
 * returning prose or validated JSON. (b) A class per feature, each
 * overriding prompt, schema and parse hooks on a shared base. (a) won: the
 * three features share exactly the checks and nothing else, so (b)'s hooks
 * would each be implemented once, a base-class interface wider than the
 * function it replaces, and every feature's own logic (the briefing's
 * facts-first fallback, Insights' pathless log line) would still live outside
 * the class.
 */

import type { Vault } from '../vault/index';
import { checkBudget, checkKillSwitch, validateModelOutput, type Schema } from './guardrails';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { DraftResult, FeatureId, GuardrailId, Refusal, RunStamp } from '$lib/shared/ai';

export type { DraftResult };

export interface DraftOptions {
	cli?: Partial<CliDeps>;
}

/** A passage of the user's notes, for `wrapAsData`. */
export interface Source {
	path: string;
	text: string;
}

/** How much of any one note goes into a prompt. */
const NOTE_CHARS = 8000;

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

/** What a run gave back: the answer, or why there is none. Both carry the stamp. */
export type RunOutcome<T> =
	| { ok: true; value: T; stamp: RunStamp }
	| { ok: false; problem: string; refusals: Refusal[]; stamp: RunStamp };

interface RunInput {
	feature: FeatureId;
	prompt: string;
	system: string;
	/** When given, the answer is JSON checked against it (G6); otherwise it is prose. */
	schema?: Schema;
	/** Vault-relative paths the run is about, for the audit log. */
	paths: string[];
	/** The log's note for a run that answered. */
	note?: string;
	cli?: Partial<CliDeps>;
}

/**
 * The one way the AI layer asks a model anything: a read-only CLI run,
 * checked and logged. Kill switch (G10) and budget (G7) before it starts;
 * no tools and never inside the vault (G2, in `cli.ts`); the answer checked
 * against `schema` when there is one (G6).
 *
 * Inputs: the vault, for settings, the day's spend and the audit log; the
 * feature, whose model settings are used; the prompt, with any note text
 * already wrapped by `wrapAsData` (G8). Output: the trimmed prose, or the
 * validated JSON as `T` when `schema` is given, or the problem and refusals.
 * Either way a stamp saying what ran. Side effects: spawns the CLI, appends
 * one line to the audit log for every run that started, with the mode it
 * actually ran in. Never writes a note, never throws, and never logs a run
 * the kill switch or the budget stopped before it began.
 */
export async function runDraft<T = string>(vault: Vault, input: RunInput): Promise<RunOutcome<T>> {
	const settings = await loadSettings(vault);
	const chosen = settings.features[input.feature];
	const startedAt = new Date().toISOString();
	let stamp: RunStamp = { ...chosen, feature: input.feature, startedAt, durationMs: 0, costUsd: 0 };
	const fail = (problem: string, refusals: Refusal[]) => ({ ok: false as const, problem, refusals, stamp });

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return fail(stop[0].message, stop);

	const spend = await spentOn(vault, startedAt.slice(0, 10));
	const budget = checkBudget(chosen, spend.usd, settings.budget);
	if (budget.refusals.length) return fail(budget.refusals[0].message, budget.refusals);

	const result = await runClaude(
		{ prompt: input.prompt, settings: budget.settings, systemPrompt: input.system, jsonSchema: input.schema },
		input.cli
	);
	stamp = { ...stamp, ...budget.settings, durationMs: result.durationMs, costUsd: result.ok ? result.costUsd : 0 };
	const log = (decision: 'answered' | 'refused' | 'failed', note: string, guardrails: GuardrailId[] = []) =>
		logRun(vault, {
			at: startedAt,
			feature: input.feature,
			model: stamp.model,
			effort: stamp.effort,
			paths: input.paths,
			decision,
			guardrails,
			costUsd: stamp.costUsd,
			durationMs: stamp.durationMs,
			note
		});

	if (!result.ok) {
		await log(result.reason === 'refused' ? 'refused' : 'failed', result.message, [...new Set(result.refusals.map((r) => r.guardrail))]);
		return fail(result.message, result.refusals);
	}
	if (input.schema === undefined) {
		await log('answered', input.note ?? `${input.feature} answered`);
		return { ok: true, value: result.text.trim() as T, stamp };
	}
	const checked = validateModelOutput<T>(result.json, input.schema);
	if (!checked.ok) {
		await log('refused', 'model output did not match the schema', ['G6']);
		return fail(checked.refusals[0].message, checked.refusals);
	}
	await log('answered', input.note ?? `${input.feature} answered`);
	return { ok: true, value: checked.value, stamp };
}

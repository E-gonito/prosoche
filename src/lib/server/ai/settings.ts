/**
 * The AI controls, kept in the user's own file.
 *
 * The requirement, in the user's words: "For any feature that uses claude
 * code, ensure that I can pick the effort level, permissions and model being
 * used, and that by default there are guardrails in place and enforced to
 * prevent mistakes from the LLM." So every feature has its own model, effort
 * and permission mode, the defaults are the cautious ones, and the file that
 * holds them is `_hub/ai.md` - readable markdown frontmatter, editable in
 * Obsidian, versioned with the vault, because it is the user's settings and
 * not the app's database.
 *
 * This module is deliberately forgiving on read and strict on write. A value
 * the user has mistyped falls back to the default for that field rather than
 * taking the whole page down; an unknown permission mode falls back to
 * `read-only`, never to something more permissive. It is also the reason
 * `_hub/ai.md` is in G4's always-denied set: the settings page writes it, a
 * model never can.
 */

import { parseNote } from '../parse/note';
import { config } from '../config';
import type { Vault } from '../vault/index';
import { DEFAULT_BLAST, DEFAULT_BUDGET } from './guardrails';
import {
	EFFORTS,
	type AiSettings,
	FEATURE_DEFAULTS,
	FEATURE_LABELS,
	MODELS,
	PERMISSION_MODES,
	type Effort,
	type FeatureId,
	type Model,
	type PermissionMode,
	type RunSettings
} from '$lib/shared/ai';

export const SETTINGS_PATH = `${config.hubFolder}/ai.md`;

export type { AiSettings };

const FEATURES = Object.keys(FEATURE_DEFAULTS) as FeatureId[];
const MODEL_IDS = MODELS.map((m) => m.id) as readonly string[];
const MODE_IDS = PERMISSION_MODES.map((m) => m.id) as readonly string[];

/**
 * The settings a vault with no `_hub/ai.md` gets: off, everything read-only,
 * small budgets.
 *
 * Off is the important one. A vault that has never had this file is a vault
 * whose owner has not seen the settings page, and the alternative — spending
 * their money and running a model against their notes the first time the
 * process starts — is not a default anyone would choose if asked. Turning it
 * on is one checkbox and it writes the file, so the decision is recorded.
 */
export function defaultSettings(): AiSettings {
	return {
		enabled: false,
		budget: { ...DEFAULT_BUDGET },
		blast: { maxFiles: DEFAULT_BLAST.maxFiles, maxLineLoss: DEFAULT_BLAST.maxLineLoss },
		features: Object.fromEntries(FEATURES.map((f) => [f, { ...FEATURE_DEFAULTS[f] }])) as Record<FeatureId, RunSettings>
	};
}

/**
 * Read `_hub/ai.md`.
 *
 * Inputs: the vault. Output: the settings, with every field the file does not
 * supply filled in from the defaults. Side effects: reads one note; never
 * writes, so opening the settings page does not create a file.
 *
 * Never throws and never returns a value outside the allowed sets: a model id
 * this version does not know, an effort of `maximum`, a permission mode of
 * `bypass` all become the default for that field. Failing towards the
 * cautious value is the whole point - a typo must not widen what a model may
 * do.
 */
export async function loadSettings(vault: Vault): Promise<AiSettings> {
	const note = await vault.read(SETTINGS_PATH);
	if (!note.exists) return defaultSettings();
	return fromFrontmatter(parseNote(note.content, SETTINGS_PATH).frontmatter);
}

/** Parse the frontmatter of `_hub/ai.md`. Exported because it is the part worth testing. */
export function fromFrontmatter(fm: Record<string, unknown>): AiSettings {
	const base = defaultSettings();
	// A `defaults:` block applies to every feature; a feature's own row wins
	// field by field, so "Opus for the weekly review" is one line to write.
	const shared = record(fm.defaults);
	const features = Object.fromEntries(
		FEATURES.map((feature) => [
			feature,
			readRun({ ...shared, ...record(record(fm.features)[feature]) }, FEATURE_DEFAULTS[feature])
		])
	) as Record<FeatureId, RunSettings>;

	return {
		enabled: bool(fm.enabled, base.enabled),
		budget: {
			dailyUsd: num(fm.daily_budget_usd, base.budget.dailyUsd, 0, 100),
			maxConcurrent: Math.round(num(fm.max_concurrent, base.budget.maxConcurrent, 1, 4)),
			maxTimeoutSeconds: Math.round(num(fm.max_timeout_s, base.budget.maxTimeoutSeconds, 5, 900)),
			maxRunUsd: num(fm.max_run_usd, base.budget.maxRunUsd, 0, 10)
		},
		blast: {
			maxFiles: Math.round(num(fm.max_files, base.blast.maxFiles, 1, 20)),
			maxLineLoss: num(fm.max_line_loss, base.blast.maxLineLoss, 0, 1)
		},
		features
	};
}

/**
 * One feature's row over the shipped default for that feature. Every field is
 * independent, so a partial row - the normal case - keeps the rest.
 */
function readRun(fm: Record<string, unknown>, shipped: RunSettings): RunSettings {
	return {
		model: pick(fm.model, MODEL_IDS, shipped.model) as Model,
		effort: pick(fm.effort, EFFORTS, shipped.effort) as Effort,
		permission: pick(fm.permission, MODE_IDS, shipped.permission) as PermissionMode,
		budgetUsd: num(fm.budget_usd, shipped.budgetUsd, 0, 10),
		timeoutSeconds: Math.round(num(fm.timeout_s, shipped.timeoutSeconds, 5, 900))
	};
}

/**
 * Write `_hub/ai.md`.
 *
 * Inputs: the vault and something shaped like settings - the argument is
 * `unknown` on purpose, because the caller is a form post and pretending
 * otherwise would only move the validation somewhere less careful. Output:
 * the settings as stored, after the same clamping a read applies, so the page
 * always shows what is really in force. Side effects: writes that one note.
 *
 * This is a human action from the settings page, which is why it may write
 * the one file every AI code path is forbidden to touch. Nothing under `ai/`
 * calls it. Never stores a value outside the allowed sets, so a crafted
 * request cannot install `permission: bypass` for next time.
 */
export async function saveSettings(vault: Vault, settings: unknown): Promise<AiSettings> {
	const stored = normalise(settings);
	await vault.write(SETTINGS_PATH, render(stored));
	return stored;
}

/**
 * Read a browser-shaped settings object into a trustworthy one.
 *
 * Inputs: anything. Output: valid settings, every unrecognised field replaced
 * by its default. Side effects: none. The browser speaks camelCase and the
 * file speaks snake_case; this is the one place that knows both, so the
 * checking happens once rather than at each end.
 */
export function normalise(value: unknown): AiSettings {
	const raw = record(value);
	const budget = record(raw.budget);
	const blast = record(raw.blast);
	const features = record(raw.features);
	return fromFrontmatter({
		enabled: raw.enabled,
		daily_budget_usd: budget.dailyUsd,
		max_concurrent: budget.maxConcurrent,
		max_timeout_s: budget.maxTimeoutSeconds,
		max_run_usd: budget.maxRunUsd,
		max_files: blast.maxFiles,
		max_line_loss: blast.maxLineLoss,
		features: Object.fromEntries(
			FEATURES.map((f) => {
				const row = record(features[f]);
				return [f, { model: row.model, effort: row.effort, permission: row.permission, budget_usd: row.budgetUsd, timeout_s: row.timeoutSeconds }];
			})
		)
	});
}

/** The frontmatter object, as a plain record, for round-trip testing. */
export function toFrontmatter(settings: AiSettings): Record<string, unknown> {
	return {
		enabled: settings.enabled,
		daily_budget_usd: settings.budget.dailyUsd,
		max_concurrent: settings.budget.maxConcurrent,
		max_timeout_s: settings.budget.maxTimeoutSeconds,
		max_run_usd: settings.budget.maxRunUsd,
		max_files: settings.blast.maxFiles,
		max_line_loss: settings.blast.maxLineLoss,
		features: Object.fromEntries(
			FEATURES.map((f) => [
				f,
				{
					model: settings.features[f].model,
					effort: settings.features[f].effort,
					permission: settings.features[f].permission,
					budget_usd: settings.features[f].budgetUsd,
					timeout_s: settings.features[f].timeoutSeconds
				}
			])
		)
	};
}

/** The file as a person reads it: frontmatter first, then what it all means. */
function render(settings: AiSettings): string {
	const rows = FEATURES.map((f) => {
		const run = settings.features[f];
		return [
			`  ${f}:`,
			`    model: ${run.model}`,
			`    effort: ${run.effort}`,
			`    permission: ${run.permission}`,
			`    budget_usd: ${run.budgetUsd}`,
			`    timeout_s: ${run.timeoutSeconds}`
		].join('\n');
	}).join('\n');

	const table = FEATURES.map((f) => {
		const run = settings.features[f];
		return `| ${FEATURE_LABELS[f]} | ${run.model} | ${run.effort} | ${run.permission} |`;
	}).join('\n');

	return `---
enabled: ${settings.enabled}
daily_budget_usd: ${settings.budget.dailyUsd}
max_concurrent: ${settings.budget.maxConcurrent}
max_timeout_s: ${settings.budget.maxTimeoutSeconds}
max_run_usd: ${settings.budget.maxRunUsd}
max_files: ${settings.blast.maxFiles}
max_line_loss: ${settings.blast.maxLineLoss}
features:
${rows}
---

# AI settings

Edit this file in Obsidian or from the hub's Settings page; both write the
same frontmatter. \`enabled: false\` is the kill switch and stops every AI
surface and every scheduled job at once.

| Feature | Model | Effort | Permission |
|---|---|---|---|
${table}

**Permission** is one of \`read-only\` (no tools at all; the server puts the
notes in the prompt), \`propose\` (tools inside a throwaway copy of the vault,
and the difference comes back as a diff to accept or reject) or \`apply\`
(the same, with accept on one click). There is no mode that writes without
you, and there never will be: the hub does not pass
\`--dangerously-skip-permissions\`.

**Effort** is \`low\`, \`medium\`, \`high\` or \`xhigh\`. **Model** is one of
${MODEL_IDS.join(', ')}.

The limits below the budgets are enforced whatever a feature asks for: at most
${settings.blast.maxFiles} files in one proposal, no file may lose more than
${Math.round(settings.blast.maxLineLoss * 100)}% of its lines, and
\`.obsidian/\`, \`.git/\`, \`.stversions/\`, this file and \`CLAUDE.md\` are
never writable by an AI path. Every run is logged to \`_hub/ai-log/\`.
`;
}

/* ---------------------------------------------------------------- values -- */

function record(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bool(value: unknown, fallback: boolean): boolean {
	if (typeof value === 'boolean') return value;
	if (value === 'true') return true;
	if (value === 'false') return false;
	return fallback;
}

/** Numbers are clamped rather than rejected, so `0.5` for a percentage works. */
function num(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(Math.max(n, min), max);
}

/** An enum value, or the fallback. Never the raw string. */
function pick(value: unknown, allowed: readonly string[], fallback: string): string {
	return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/**
 * Insights: a read on patterns in the dating log, on demand.
 *
 * Read-only in every sense that matters here, not just by the permission
 * mode: this file never touches the Vault at all. `dating.ts`'s
 * `gatherInsightsSource` is the only thing that reads `Private/Dating`, and
 * it hands back plain data — day counts, a person's stage, their dates log —
 * which is all `buildPrompt` is given to work with. There is no retrieval
 * step and no `wrapAsData` passage from anywhere else in the vault, so an
 * answer here cannot lean on a note this module was never shown.
 *
 * Never writes. `runDatingInsights` produces text for the screen and nothing
 * else; there is no proposal, because there is nothing to accept.
 */

import { today } from '../daily';
import type { InsightsSource } from '../dating';
import type { Vault } from '../vault/index';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import { checkBudget, checkKillSwitch, wrapAsData } from './guardrails';
import { loadSettings } from './settings';
import type { RunStamp } from '$lib/shared/ai';

export interface DatingInsightsResult {
	text: string;
	problem: string | null;
	stamp: RunStamp | null;
}

/**
 * The prompt, from dating data alone.
 *
 * Pure, and exported so a test can pin exactly what a given source produces:
 * one passage for the ledger, one per person, and nothing else — proof that
 * the feature cannot smuggle in another note.
 */
export function buildPrompt(source: InsightsSource): string {
	const ledgerText = source.ledger.length
		? source.ledger
				.map((e) => {
					const c = e.counts;
					const parts = [`sent ${c.sent}`, `matches ${c.matches}`, `type ${c.type}`, `received ${c.received}`];
					return `${e.day} ${parts.join(', ')}${e.notes ? ` — ${e.notes}` : ''}`;
				})
				.join('\n')
		: 'No days logged yet.';

	const passages = [
		{ path: 'Ledger', text: ledgerText },
		...source.people.map((p) => ({
			path: `Person: ${p.name}`,
			text: [
				`Stage: ${p.stage ?? 'unknown'}`,
				...p.dates.map((d) => {
					const bits = [d.text];
					if (d.rating !== null) bits.push(`rating ${d.rating}`);
					if (d.cost !== null) bits.push(`cost ${d.cost}`);
					if (d.notes) bits.push(`— ${d.notes}`);
					return `${d.day} ${bits.join(' ')}`.trim();
				})
			].join('\n')
		}))
	];

	return [
		`As of ${source.asOf}, read for patterns across this dating log. Be brief, specific and warm; do not moralise.`,
		'"Matches" is defined as matches from the user\'s own likes, whenever they arrived — not likes returned to an incoming like — so do not treat a high match rate as automatically suspicious.',
		'',
		wrapAsData(passages)
	].join('\n');
}

/**
 * Run Insights once.
 *
 * Inputs: the vault (for settings, budget and the audit log only — never for
 * dating data) and a source already gathered by `dating.ts`. Output: the
 * text, or a problem when the kill switch, the budget or the model itself
 * refused. Side effects: spawns the CLI, appends one line to the shared
 * `_hub/ai-log/`, naming no dating path and quoting no dating text, so the
 * public audit trail learns nothing private happened beyond "this ran".
 */
export async function runDatingInsights(
	vault: Vault,
	source: InsightsSource,
	overrides: Partial<CliDeps> = {}
): Promise<DatingInsightsResult> {
	const settings = await loadSettings(vault);
	const chosen = settings.features['dating-insights'];
	const startedAt = new Date().toISOString();
	const day = today();

	const killed = checkKillSwitch(settings.enabled);
	if (killed.length) return { text: '', problem: killed[0].message, stamp: null };

	const spend = await spentOn(vault, day);
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	if (budget.refusals.length) return { text: '', problem: budget.refusals[0].message, stamp: null };

	const result = await runClaude(
		{
			prompt: buildPrompt(source),
			settings: { ...budget.settings, permission: 'read-only' },
			systemPrompt:
				"You are reading one person's private dating log, given to you directly as data. " +
				'Answer only from it; do not assume anything it does not say.'
		},
		overrides
	);

	const stamp: RunStamp = {
		...budget.settings,
		feature: 'dating-insights',
		startedAt,
		durationMs: result.durationMs,
		costUsd: result.ok ? result.costUsd : 0
	};

	await logRun(vault, {
		at: startedAt,
		feature: 'dating-insights',
		model: stamp.model,
		effort: stamp.effort,
		permission: stamp.permission,
		// No paths: Private/Dating never appears in the public audit trail.
		paths: [],
		decision: result.ok ? 'answered' : result.reason === 'refused' ? 'refused' : 'failed',
		guardrails: result.ok ? [] : [...new Set(result.refusals.map((r) => r.guardrail))],
		costUsd: stamp.costUsd,
		durationMs: stamp.durationMs,
		note: result.ok ? 'dating insights requested' : result.message
	});

	if (!result.ok) return { text: '', problem: result.message, stamp };
	return { text: result.text.trim(), problem: null, stamp };
}

/**
 * Insights: a read on patterns in the dating log, on demand.
 *
 * Read-only like every run, and more: this file never touches the Vault at
 * all. `dating.ts`'s
 * `gatherInsightsSource` is the only thing that reads `Private/Dating`, and
 * it hands back plain data — day counts, a person's stage, their dates log —
 * which is all `buildPrompt` is given to work with. There is no retrieval
 * step and no `wrapAsData` passage from anywhere else in the vault, so an
 * answer here cannot lean on a note this module was never shown.
 *
 * Never writes. `runDatingInsights` produces text for the screen and nothing
 * else; there is no proposal, because there is nothing to accept.
 */

import type { InsightsSource } from '../dating';
import type { Vault } from '../vault/index';
import type { CliDeps } from './cli';
import { wrapAsData } from './guardrails';
import { runDraft } from './run';

interface DatingInsightsResult {
	text: string;
	problem: string | null;
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
 * Run Insights once, through the shared runner.
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
	cli: Partial<CliDeps> = {}
): Promise<DatingInsightsResult> {
	const run = await runDraft(vault, {
		feature: 'dating-insights',
		prompt: buildPrompt(source),
		system:
			"You are reading one person's private dating log, given to you directly as data. " +
			'Answer only from it; do not assume anything it does not say.',
		// No paths: Private/Dating never appears in the public audit trail.
		paths: [],
		note: 'dating insights requested',
		cli
	});
	return run.ok ? { text: run.value, problem: null } : { text: '', problem: run.problem };
}

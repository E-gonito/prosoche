/**
 * The `insights` widget: Ask, with the scope already chosen.
 *
 * A workspace tab knows what it is about, so a question asked there should
 * not have to say so again. This loader therefore does no model work at all -
 * it only works out the scope, counts what is in it and what a question there
 * would be answered from, and hands the browser the per-run settings to show. The question itself goes through the same
 * `/api/ai/ask` endpoint as the Ask page, so there is one code path, one set
 * of guardrails and one audit line whichever surface it came from.
 */

import type { WidgetContext } from '../widgets';
import { loadSettings } from '../ai/settings';
import { factCounts, gatherWorkspaceFacts, type FactCounts } from '../ai/facts';
import { scopeFilter } from '../ai/retrieval';
import type { RunSettings, Scope } from '$lib/shared/ai';

export interface InsightsData {
	scope: Scope;
	/** What the scope is called on screen. */
	label: string;
	/** Notes the scope contains, so an empty workspace says so up front. */
	notes: number;
	/**
	 * The size of the figures a question here would be answered from, or null
	 * outside a workspace, where there are none. Counts only: the widget says
	 * what the model will see without paying to render it.
	 */
	facts: FactCounts | null;
	settings: RunSettings;
	/** False when the kill switch is off; the widget then offers nothing. */
	enabled: boolean;
	/** Questions worth a click, so the box is not a blank stare. */
	suggestions: string[];
}

/**
 * Inputs: the widget context. Output: the scope, its size, the size of the
 * figures behind it and the run settings. Side effects: reads `_hub/ai.md`,
 * lists the vault, and queries the index and the week's daily notes.
 *
 * Never runs a model and never writes: loading a workspace tab must not cost
 * money or make an API call, so the question waits for someone to ask it. The
 * figures are queries, which is exactly why they can be counted on load.
 */
export async function load(ctx: WidgetContext): Promise<InsightsData> {
	const scope: Scope = ctx.workspace ? { kind: 'workspace', slug: ctx.workspace.slug } : { kind: 'vault' };
	const settings = await loadSettings(ctx.vault);
	const within = scopeFilter(scope, ctx.workspaces);
	const notes = (await ctx.vault.list()).filter(within).length;

	return {
		scope,
		label: ctx.workspace?.name ?? 'the whole vault',
		notes,
		facts: await counts(ctx),
		settings: settings.features.insights,
		enabled: settings.enabled,
		suggestions: suggestions(ctx.workspace?.name ?? null)
	};
}

/**
 * The figures' size, or null when there are none to have. A failure counts as
 * none: the box must still take a question when the index is mid-rebuild.
 */
async function counts(ctx: WidgetContext): Promise<FactCounts | null> {
	if (!ctx.workspace) return null;
	try {
		return factCounts(await gatherWorkspaceFacts(ctx, ctx.workspace, ctx.today));
	} catch {
		return null;
	}
}

/**
 * Questions worth the click.
 *
 * Inside a workspace they are shaped like the figures the model is handed —
 * time, finished work, what has waited longest — because those are the ones
 * it can now answer with a number rather than an impression. The last is
 * prose, and stays, since a decision and its reason live in a note and
 * nowhere else. Outside a workspace there are no figures, so none of the
 * first three are offered.
 */
function suggestions(name: string | null): string[] {
	if (!name) {
		return ['What is unfinished?', 'What did I decide recently, and why?', 'What have I not touched in a month?'];
	}
	return [
		`What did I finish in ${name} this week?`,
		`Where did my ${name} time go this week?`,
		`What in ${name} has been open longest?`,
		`What did I decide in ${name} recently, and why?`
	];
}

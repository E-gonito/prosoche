/**
 * The `insights` widget: Ask, with the scope already chosen.
 *
 * A workspace tab knows what it is about, so a question asked there should
 * not have to say so again. This loader therefore does no model work at all -
 * it only works out the scope, reports what is in it, and hands the browser
 * the per-run settings to show. The question itself goes through the same
 * `/api/ai/ask` endpoint as the Ask page, so there is one code path, one set
 * of guardrails and one audit line whichever surface it came from.
 */

import type { WidgetContext } from '../widgets';
import { loadSettings } from '../ai/settings';
import { scopeFilter } from '../ai/retrieval';
import type { RunSettings, Scope } from '$lib/shared/ai';

export interface InsightsData {
	scope: Scope;
	/** What the scope is called on screen. */
	label: string;
	/** Notes the scope contains, so an empty workspace says so up front. */
	notes: number;
	settings: RunSettings;
	/** False when the kill switch is off; the widget then offers nothing. */
	enabled: boolean;
	/** Questions worth a click, so the box is not a blank stare. */
	suggestions: string[];
}

/**
 * Inputs: the widget context. Output: the scope, its size and the run
 * settings. Side effects: reads `_hub/ai.md` and lists the vault.
 *
 * Never runs a model and never writes: loading a workspace tab must not cost
 * money or make an API call, so the question waits for someone to ask it.
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
		settings: settings.features.insights,
		enabled: settings.enabled,
		suggestions: suggestions(ctx.workspace?.name ?? null)
	};
}

function suggestions(name: string | null): string[] {
	const where = name ? ` in ${name}` : '';
	return [
		`What is unfinished${where}?`,
		`What did I decide${where} recently, and why?`,
		`What have I not touched${where} in a month?`
	];
}

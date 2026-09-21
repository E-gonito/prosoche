/**
 * Suggesting flashcards from a note the user is studying.
 *
 * The output is Spaced Repetition's own inline syntax appended to the note,
 * so a card accepted here is a card Obsidian sees, reviewable in either place
 * with no second copy anywhere. Exactly one note is touched: the one being
 * read.
 *
 * ## The rule that shapes the prompt
 *
 * A flashcard is only worth having if its answer is in the note. A model left
 * to itself will happily produce a card about something adjacent that it
 * knows and the note does not, and the user will then review, for months, an
 * answer nothing in their vault supports. So the passages are given as data
 * (G8), the model is told to quote, and every suggestion whose answer is not
 * found in the note is dropped before it becomes an edit. That check is here
 * rather than in the prompt because a prompt is a request and this is a rule.
 *
 * ## Why one edit for all of them
 *
 * A separate edit per card would let the user tick three of five, which
 * sounds better than it is: the cards go in one block under one heading, and
 * five appends to the same file are five edits whose diffs each assume the
 * others were applied. One edit with all the cards in it has one honest diff.
 * Removing a card before accepting is what `Proposal.svelte`'s edit box is
 * for.
 */

import { basename } from '../parse/note';
import type { Vault } from '../vault/index';
import { checkBudget, checkKillSwitch, validateModelOutput, wrapAsData, type Schema } from './guardrails';
import { newId } from './proposal';
import { loadSettings } from './settings';
import { logRun, spentOn } from './audit';
import { runClaude, type CliDeps } from './cli';
import type { GuardrailId, Proposal, Refusal, RunStamp } from '$lib/shared/ai';

/** Where suggested cards go in a note. Created when it is not there. */
export const CARDS_HEADING = '## Flashcards';

const SCHEMA: Schema = {
	type: 'object',
	fields: {
		cards: {
			type: 'array',
			maxItems: 12,
			of: {
				type: 'object',
				fields: {
					question: { type: 'string', minLength: 3, maxLength: 300 },
					answer: { type: 'string', minLength: 1, maxLength: 300 },
					/** The sentence in the note the answer came from. */
					quote: { type: 'string', minLength: 3, maxLength: 400 }
				}
			}
		}
	}
};

export interface Suggestion {
	question: string;
	answer: string;
	quote: string;
}

export interface SuggestResult {
	proposal: Proposal | null;
	/** Suggestions dropped because the note does not support them. */
	unsupported: Suggestion[];
	problem: string | null;
	refusals: Refusal[];
}

/**
 * Suggest cards for one note.
 *
 * Inputs: the vault, the note's path, and how many cards to aim for. Output a
 * proposal of one `append` edit, plus whatever was dropped. Side effects:
 * spawns the CLI, appends to the audit log. Never writes a note.
 *
 * Never targets a note other than the one asked about, and never suggests a
 * card whose answer is absent from that note. An empty note, a missing note
 * and a model that returns nothing all come back as no proposal and no
 * problem: there is simply nothing to suggest.
 */
export async function suggestCards(
	vault: Vault,
	path: string,
	options: { count?: number; cli?: Partial<CliDeps> } = {}
): Promise<SuggestResult> {
	const settings = await loadSettings(vault);
	const chosen = settings.features['suggest-flashcards'];
	const startedAt = new Date().toISOString();

	const stop = checkKillSwitch(settings.enabled);
	if (stop.length) return { proposal: null, unsupported: [], problem: stop[0].message, refusals: stop };

	const note = await vault.read(path);
	if (!note.exists || note.content.trim() === '') {
		return { proposal: null, unsupported: [], problem: null, refusals: [] };
	}

	const spend = await spentOn(vault, startedAt.slice(0, 10));
	const budget = checkBudget(chosen, { todayUsd: spend.usd, running: 0 }, settings.budget);
	if (budget.refusals.length) {
		return { proposal: null, unsupported: [], problem: budget.refusals[0].message, refusals: budget.refusals };
	}

	const result = await runClaude(
		{
			prompt: prompt(path, note.content, options.count ?? 6),
			settings: { ...budget.settings, permission: 'read-only' },
			systemPrompt:
				'You write flashcards from one person\'s notes. Answer only with JSON: ' +
				'{"cards":[{"question":"…","answer":"…","quote":"the sentence from the note that supports the answer"}]}. ' +
				'The answer must be in the note. If the note does not support a card, do not write it.',
			jsonSchema: SCHEMA
		},
		options.cli
	);

	const stamp: RunStamp = {
		...budget.settings,
		feature: 'suggest-flashcards',
		startedAt,
		durationMs: result.durationMs,
		costUsd: result.ok ? result.costUsd : 0
	};

	const log = (decision: 'proposed' | 'refused' | 'failed', text: string, guardrails: GuardrailId[] = []) =>
		logRun(vault, {
			at: startedAt,
			feature: 'suggest-flashcards',
			model: stamp.model,
			effort: stamp.effort,
			permission: stamp.permission,
			paths: [path],
			decision,
			guardrails,
			costUsd: stamp.costUsd,
			durationMs: stamp.durationMs,
			note: text
		});

	if (!result.ok) {
		await log(result.reason === 'refused' ? 'refused' : 'failed', result.message, result.refusals.map((r) => r.guardrail));
		return { proposal: null, unsupported: [], problem: result.message, refusals: result.refusals };
	}

	const checked = validateModelOutput<{ cards: Suggestion[] }>(result.json, SCHEMA);
	if (!checked.ok) {
		await log('refused', 'model output did not match the schema', ['G6']);
		return { proposal: null, unsupported: [], problem: checked.refusals[0].message, refusals: checked.refusals };
	}

	const { supported, unsupported } = partition(checked.value.cards, note.content);
	if (supported.length === 0) {
		await log('refused', `all ${unsupported.length} suggestions were unsupported by the note`, ['G6']);
		return { proposal: null, unsupported, problem: null, refusals: [] };
	}

	const proposal = propose(path, supported, stamp);
	await log('proposed', proposal.summary);
	return { proposal, unsupported, problem: null, refusals: [] };
}

/**
 * The cards as one append edit.
 *
 * Pure. The block carries the heading only when the note has none, because
 * appending a second `## Flashcards` to a note that already has one is how
 * the plugin ends up with two places to look.
 */
export function propose(path: string, cards: Suggestion[], stamp: RunStamp): Proposal {
	const lines = cards.map((c) => `${c.question.replace(/\s+/g, ' ').trim()}::${c.answer.replace(/\s+/g, ' ').trim()}`);
	return {
		id: newId('cards'),
		feature: 'suggest-flashcards',
		stamp,
		summary: `${cards.length} flashcard${cards.length === 1 ? '' : 's'} for ${basename(path)}.`,
		edits: [
			{
				id: newId('edit'),
				kind: 'append',
				path,
				text: `\n${lines.join('\n')}\n`,
				reason:
					'Inline cards in Spaced Repetition\'s own syntax, so Obsidian sees them too. ' +
					'Edit the text before accepting to drop or reword any of them.'
			}
		],
		accepted: []
	};
}

/**
 * Split suggestions into those the note supports and those it does not.
 *
 * Support means the quoted sentence appears in the note and the answer
 * appears in that quote, compared on words rather than characters so
 * punctuation and line wrapping do not fail a good card. Exported because
 * this is the rule the module exists to enforce, and a rule worth stating is
 * worth testing.
 */
export function partition(
	cards: Suggestion[],
	content: string
): { supported: Suggestion[]; unsupported: Suggestion[] } {
	const haystack = words(content);
	const supported: Suggestion[] = [];
	const unsupported: Suggestion[] = [];
	for (const card of cards) {
		const quote = words(card.quote);
		const answer = words(card.answer);
		const ok = quote.length > 0 && haystack.includes(quote) && quote.includes(answer);
		(ok ? supported : unsupported).push(card);
	}
	return { supported, unsupported };
}

/** Text reduced to single-spaced lowercase words, for a comparison that holds. */
function words(text: string): string {
	return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

function prompt(path: string, content: string, count: number): string {
	return [
		`Write up to ${count} flashcards from this note. Fewer is better than worse ones.`,
		'A good card asks one thing and has a short answer that is stated in the note.',
		'Do not write cards about what the note does not say.',
		'',
		wrapAsData([{ path, text: content.slice(0, 20000) }])
	].join('\n');
}

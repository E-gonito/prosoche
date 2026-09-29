/**
 * Drafting flashcards from the notes a person picks, for the Make cards page.
 *
 * The output is a list of cards and nothing more. Nothing in this file
 * writes to the vault: the page shows the cards, a person ticks and edits
 * them, and `study/card-files.ts` writes what they chose, into the subject's
 * own card file, after checking all of it again. That separation is the
 * accept step: the model's answer never reaches a file on its own.
 *
 * ## The rule that shapes it
 *
 * A flashcard is only worth having if its answer is in the note. A model left
 * to itself will happily produce a card about something adjacent that it
 * knows and the note does not, and the person will then review, for months,
 * an answer nothing in their vault supports. So the notes are given as data
 * (G8), the model must name the note each card came from and quote a
 * sentence of it, and a card is kept only when that note was sent, the quote
 * is in it and the answer is in the quote. That check is here rather than in
 * the prompt because a prompt is a request and this is a rule.
 *
 * ## Reading many notes
 *
 * The notes picked (folders expanded, see `pickedNotes`) are read in order
 * until `MAKE_CHARS` of text is gathered, each at most `MAKE_NOTE_CHARS`, as
 * "Find terms in my notes" does; the result says how far it got, so a big
 * folder is drafted a batch at a time.
 *
 * The run uses the "Suggest flashcards" model settings, always read-only.
 */

import { basename } from '../parse/note';
import { cardBlock } from '../study/anki-import';
import { cardFilePath, pickedNotes, questionKey, sourceNotes } from '../study/card-files';
import { scanCards } from '../study/flashcards';
import { findGoal, goalRefs, readGoals } from '../study/goals';
import type { Subject } from '../study/subjects';
import type { Vault } from '../vault/index';
import { wrapAsData, type Schema } from './guardrails';
import { runDraft, type DraftOptions, type Source } from './meeting-drafts';
import type { CardDraft, DraftedCard, DroppedCard, SourceBatch } from '$lib/shared/study';

/** How many cards a run may be asked for; the page offers these. */
export const CARD_COUNTS = [5, 10, 20] as const;

/** How much note text one run reads, in characters. */
export const MAKE_CHARS = 40_000;
/** How much of any one note it reads. */
export const MAKE_NOTE_CHARS = 12_000;
/** Questions already in the card file, listed in the prompt so they are not asked again. */
const ASKED_IN_PROMPT = 80;

const SCHEMA: Schema = {
	type: 'object',
	fields: {
		cards: {
			type: 'array',
			maxItems: 20,
			of: {
				type: 'object',
				fields: {
					question: { type: 'string', minLength: 3, maxLength: 400 },
					answer: { type: 'string', minLength: 1, maxLength: 600 },
					/** The path of the note it came from, as the prompt gave it. */
					source: { type: 'string', minLength: 1, maxLength: 400 },
					/** A sentence of that note that holds the answer. */
					quote: { type: 'string', minLength: 3, maxLength: 600 }
				}
			}
		}
	}
};

/** One card as the model proposes it. */
export interface Suggestion {
	question: string;
	answer: string;
	source: string;
	quote: string;
}

/**
 * The prompt for drafting cards. Pure. The questions the card file already
 * asks are listed so the model does not spend its answer on them; they are
 * checked again afterwards regardless.
 */
export function cardsPrompt(input: { subject: string; goal: string | null; count: number; asked: string[]; sources: Source[] }): string {
	const asked = input.asked.slice(0, ASKED_IN_PROMPT);
	return [
		`Write up to ${input.count} flashcards from the notes below, for the user's "${input.subject}" studies` +
			(input.goal ? `, towards their goal "${input.goal}".` : '.'),
		'Fewer, better cards beat many. A good card asks one thing, and its answer is short and stated in the note.',
		'Do not write a card about anything the notes do not say.',
		asked.length ? `The user already has cards asking these; do not ask them again:\n${asked.map((q) => `- ${q.replace(/\s+/g, ' ')}`).join('\n')}` : '',
		'',
		'For each card give:',
		'- question: one question, in plain words',
		'- answer: short, in the words of the note',
		'- source: the path of the note it came from, exactly as given in its path attribute',
		'- quote: one sentence copied word for word from that note, containing every word of the answer',
		'',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * Split suggestions into those the notes support and those they do not.
 *
 * Support means the card's `source` is one of the notes sent, its quote is
 * found in that note's text as sent, and its answer is found in the quote,
 * all compared on words (see `words`), so punctuation and line wrapping do
 * not fail a good card. Pure. Exported because this is the rule the feature
 * exists to enforce.
 */
export function groundCards(cards: Suggestion[], sources: Source[]): { supported: Suggestion[]; dropped: Suggestion[] } {
	const text = new Map(sources.map((s) => [s.path, words(s.text)]));
	const supported: Suggestion[] = [];
	const dropped: Suggestion[] = [];
	for (const card of cards) {
		const note = text.get(card.source.trim());
		const quote = words(card.quote);
		const answer = words(card.answer);
		const ok = Boolean(note) && quote.trim() !== '' && answer.trim() !== '' && note!.includes(quote) && quote.includes(answer);
		(ok ? supported : dropped).push(card);
	}
	return { supported, dropped };
}

/**
 * Text reduced to single-spaced lowercase words with a space at either end,
 * so `words(a).includes(words(b))` asks whether b's words run in order
 * inside a's, whatever the punctuation and line wrapping. The grounding
 * check for anything a model says a note supports. Pure.
 */
export function words(text: string): string {
	return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Draft cards for one subject from the notes and folders picked, starting at
 * the `from`th note, for the card file of `goal` (none when null).
 *
 * Reads up to `MAKE_CHARS` of the notes, asks Claude for up to `count` cards
 * (5, 10 or 20; anything else is 10), and keeps those the notes support (see
 * `groundCards`) and that can be written as a card (`cardBlock`), with both
 * sides as they would be written. A card whose question the destination
 * file already asks, or that an earlier card asked, is left out and listed.
 * A pick of nothing, a goal not in `Goals.md` and notes that are all empty
 * come back as a problem to show, not an error.
 *
 * Side effects: reads notes, spawns the CLI read-only, appends to the audit
 * log. Never writes a note or a card file.
 */
export async function draftCards(
	vault: Vault,
	subject: Subject,
	input: { notes?: string[]; folders?: string[]; goal?: string | null; count?: number; from?: number },
	options: DraftOptions = {}
): Promise<CardDraft> {
	const wanted = input.goal?.trim() || null;
	const goal = wanted ? findGoal(goalRefs(await readGoals(vault, subject.files.goals)), wanted) : null;
	const destination = cardFilePath(subject, goal?.name ?? null);
	const none = (problem: string | null, batch: SourceBatch | null = null): CardDraft => ({ cards: [], dropped: [], duplicates: [], batch, destination, problem });
	if (wanted && !goal) return none(`There is no goal called "${wanted}" in ${subject.name}'s Goals.md.`);

	const paths = pickedNotes((await sourceNotes(vault, subject)).notes, input);
	if (paths.length === 0) return none('Pick a note or a folder to make cards from.');
	const count = (CARD_COUNTS as readonly number[]).includes(input.count ?? 0) ? input.count! : 10;

	const from = Math.min(Math.max(0, Math.floor(input.from ?? 0)), paths.length - 1);
	const sources: Source[] = [];
	let chars = 0;
	let i = from;
	while (i < paths.length) {
		const text = (await vault.read(paths[i])).content.slice(0, MAKE_NOTE_CHARS);
		if (sources.length && chars + text.length > MAKE_CHARS) break;
		i++;
		if (!text.trim()) continue;
		sources.push({ path: paths[i - 1], text });
		chars += text.length;
	}
	const batch: SourceBatch = { from, read: i - from, total: paths.length, chars, next: i < paths.length ? i : null };
	if (sources.length === 0) return none(batch.read === 1 ? 'That note is empty.' : 'Those notes are empty.', batch);

	const asked = scanCards((await vault.read(destination)).content, destination).map((c) => c.question);
	const run = await runDraft<{ cards: Suggestion[] }>(vault, {
		feature: 'suggest-flashcards',
		prompt: cardsPrompt({ subject: subject.name, goal: goal?.name ?? null, count, asked, sources }),
		system:
			'You write flashcards from one person\'s notes. Answer only with JSON: ' +
			'{"cards":[{"question":"…","answer":"…","source":"<path>","quote":"<sentence from that note holding the answer>"}]}. ' +
			'Every card must come from a note given; if the notes do not support a card, do not write it.',
		schema: SCHEMA,
		paths: sources.map((s) => s.path),
		cli: options.cli
	});
	if (!run.ok) return none(run.result.problem ?? 'Claude did not answer.', batch);

	const { supported, dropped: unsupported } = groundCards(run.value.cards, sources);
	const dropped: DroppedCard[] = unsupported.map((c) => ({ question: c.question, answer: c.answer, source: c.source, why: 'unsupported' }));
	const seen = new Set(asked.map(questionKey));
	const cards: DraftedCard[] = [];
	const duplicates: string[] = [];
	for (const card of supported) {
		const block = cardBlock(card.question, card.answer);
		if (!block) {
			dropped.push({ question: card.question, answer: card.answer, source: card.source, why: 'unwritable' });
			continue;
		}
		const key = questionKey(block.card.front);
		if (seen.has(key)) {
			duplicates.push(block.card.front);
			continue;
		}
		seen.add(key);
		const source = card.source.trim();
		cards.push({ question: block.card.front, answer: block.card.back, quote: card.quote.trim(), source, note: basename(source) });
	}

	const kept = cards.slice(0, count);
	const problem = kept.length || dropped.length || duplicates.length ? null : 'No cards turned up in these notes.';
	return { cards: kept, dropped, duplicates, batch, destination, problem };
}

/**
 * What Claude drafts for a glossary: definitions for the terms waiting to be
 * looked up, and new entries for terms found in the notes it is scanned from.
 *
 * Nothing in this file writes to the vault. A look-up is a proposal with one
 * destination, the glossary's own file in `Glossaries/`, which
 * `proposal.apply` writes after a human accepts. A scan is a list of
 * candidates for a person to tick and edit, which `addScannedTerms` in
 * `glossary.ts` writes when they press Add. The model is given the notes as
 * data (G8) and answers in a fixed JSON shape (G6). Both run with the
 * glossary look-up's model settings (`glossary-lookup`).
 *
 * ## Scanning, and the rule that shapes it
 *
 * A glossary names the folders it is scanned from in its frontmatter
 * (`sources:`, see `glossary.ts`). `scanPlan` lists the notes under them,
 * every one or only those changed since the last full scan, and splits them
 * into batches of at most `FIND_CHARS` of text (each note at most
 * `FIND_NOTE_CHARS`); the page runs `draftScan` on each batch in turn. The
 * model proposes entries, each naming the note it came from and quoting a
 * sentence of it. As in `suggest-cards.ts`, an entry is kept only when its
 * quote is found in that note and the term is found in its quote; the rest
 * are left out, because a prompt is a request and this is a rule. Terms the
 * glossary already has, or that an earlier batch found, are skipped the same
 * way, whatever the model was told.
 *
 * The prompt builders, proposal builder and batching are pure and exported,
 * because they are the part worth testing.
 */

import type { Vault } from '../vault/index';
import { basename } from '../parse/note';
import { findEntry, insertDefinition, normaliseTerm, parseGlossary, setField, type GlossaryEntry } from '../parse/glossary';
import { scanNotes, scanSettings, type GlossaryRef } from '../glossary';
import { today } from '../daily';
import { loadMeetings, notebookPaths } from '../meetings';
import { wrapAsData, type Schema } from './guardrails';
import { asSource } from './meeting-drafts';
import { gather, nothing, runDraft, type DraftOptions, type DraftResult, type Source } from './run';
import { newId } from './proposal';
import { words } from './suggest-cards';
import type { Proposal, Refusal, RunStamp } from '$lib/shared/ai';
import { ENTRY_LIMITS, type ScanBatches, type ScanCandidate, type ScanDraft, type ScanPlan } from '$lib/shared/glossary';

/** Terms looked up in one run; more is a second press. */
const LOOKUP_LIMIT = 20;

/* ------------------------------------------------------------- lookup -- */

const LOOKUP_SCHEMA: Schema = {
	type: 'object',
	fields: {
		entries: {
			type: 'array',
			maxItems: LOOKUP_LIMIT,
			of: {
				type: 'object',
				fields: {
					term: { type: 'string', minLength: 1, maxLength: 200 },
					definition: { type: 'string', minLength: 1, maxLength: 1500 },
					relevance: { type: 'string', maxLength: 600 }
				}
			}
		}
	}
};

interface Lookup {
	term: string;
	definition: string;
	relevance: string;
}

/**
 * The prompt for glossary look-ups. Pure. The user's guess is passed along,
 * because a definition that says where the guess was right or wrong is worth
 * more than one that ignores it.
 */
export function lookupPrompt(input: { glossary: string; entries: GlossaryEntry[]; sources: Source[] }): string {
	const terms = input.entries.map((e) => {
		const extra = [e.guess ? `their guess: ${e.guess}` : null, e.category ? `category: ${e.category}` : null].filter(Boolean);
		return `- ${e.term}${extra.length ? ` (${extra.join('; ')})` : ''}`;
	});
	return [
		`Look up these terms for the user's "${input.glossary}" glossary:`,
		...terms,
		'',
		'For each, write a definition of two or three plain sentences saying what it is, and a relevance of one',
		`sentence beginning "For ${input.glossary}," saying why it matters there, grounded in the notes below.`,
		'If the notes say nothing about it, say how it would plausibly come up, and hedge. Return each term exactly as given.',
		'',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * The look-ups as one proposal: each definition and relevance inserted under
 * its entry, its status set to looked-up, and `drafted:: Claude` recorded.
 * Pure. An answer for a term that is not a pending entry is dropped. Returns
 * null when nothing is left to change.
 */
export function lookupProposal(
	path: string,
	glossary: { content: string; hash: string },
	lookups: Lookup[],
	stamp: RunStamp
): Proposal | null {
	let text = glossary.content;
	const done: string[] = [];
	for (const lookup of lookups) {
		const entry = findEntry(text, lookup.term);
		if (!entry || !entry.pending || done.includes(normaliseTerm(entry.term))) continue;
		const withDefinition = insertDefinition(text, entry.term, lookup.definition, lookup.relevance);
		const looked = withDefinition && setField(withDefinition, entry.term, 'status', 'looked-up');
		const drafted = looked && setField(looked, entry.term, 'drafted', 'Claude');
		if (!drafted) continue;
		text = drafted;
		done.push(normaliseTerm(entry.term));
	}
	if (done.length === 0) return null;
	return {
		id: newId('lookup'),
		feature: 'glossary-lookup',
		stamp,
		summary: `Definitions for ${done.length} term${done.length === 1 ? '' : 's'} in ${basename(path)}.`,
		edits: [
			{
				id: newId('edit'),
				kind: 'revise',
				path,
				text,
				expectedHash: glossary.hash,
				reason: 'Each definition and its "why it matters here" line go under the term, and its status becomes looked-up.'
			}
		],
		accepted: []
	};
}

/**
 * Look up the named terms of one glossary, or every entry still to look up
 * when `terms` is null, at most `LOOKUP_LIMIT` at a time. The context is what
 * the workspaces pointing at the glossary have: the primer of each with a
 * notebook and the last three meetings across them, or the definition file
 * of one without; a glossary no workspace points at is looked up from the
 * terms alone. Side effects: spawns the CLI, appends to the audit log.
 * Never writes a note.
 */
export async function draftLookups(vault: Vault, glossary: GlossaryRef, terms: string[] | null, options: DraftOptions = {}): Promise<DraftResult> {
	const destinations = [glossary.path];
	const note = await vault.read(glossary.path);
	const wanted = terms ? new Set(terms.map(normaliseTerm)) : null;
	const entries = parseGlossary(note.content)
		.filter((e) => e.pending && (!wanted || wanted.has(normaliseTerm(e.term))))
		.slice(0, LOOKUP_LIMIT);
	if (entries.length === 0) return { ...nothing('Nothing is waiting to be looked up.'), destinations };

	const sources = await gather(
		vault,
		glossary.linked.map((w) => notebookPaths(w)?.primer ?? w.path)
	);
	const meetings = [];
	for (const w of glossary.linked) {
		const paths = notebookPaths(w);
		if (paths) meetings.push(...(await loadMeetings(vault, paths)));
	}
	meetings.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
	sources.push(...meetings.slice(0, 3).map(asSource));

	const run = await runDraft<{ entries: Lookup[] }>(vault, {
		feature: 'glossary-lookup',
		prompt: lookupPrompt({ glossary: glossary.name, entries, sources }),
		system: 'You define terms for one person\'s glossary. Answer only with JSON: {"entries":[{"term":"…","definition":"…","relevance":"…"}]}.',
		schema: LOOKUP_SCHEMA,
		paths: [glossary.path],
		cli: options.cli
	});
	if (!run.ok) return { ...run.result, destinations };
	const proposal = lookupProposal(glossary.path, note, run.value.entries, run.stamp);
	return { proposal, problem: proposal ? null : 'The answer matched none of the terms asked about.', refusals: [], destinations };
}

/* --------------------------------------------------------------- scan -- */

/** How much note text one batch of a scan reads, in characters. */
export const FIND_CHARS = 60_000;
/** How much of any one note it reads. */
export const FIND_NOTE_CHARS = 12_000;
/** New entries one batch may propose. */
const FIND_LIMIT = 25;
/** Terms found by earlier batches that one batch is told about; more are still checked. */
const FOUND_LIMIT = 1000;

const FIND_SCHEMA: Schema = {
	type: 'object',
	fields: {
		entries: {
			type: 'array',
			maxItems: FIND_LIMIT,
			of: {
				type: 'object',
				fields: {
					term: { type: 'string', minLength: 1, maxLength: ENTRY_LIMITS.term },
					category: { type: 'string', maxLength: ENTRY_LIMITS.category },
					definition: { type: 'string', minLength: 1, maxLength: ENTRY_LIMITS.definition },
					relevance: { type: 'string', maxLength: ENTRY_LIMITS.relevance },
					/** The path of the note it came from, as the prompt gave it. */
					source: { type: 'string', minLength: 1, maxLength: 400 },
					/** A sentence of that note that uses or defines the term. */
					quote: { type: 'string', minLength: 3, maxLength: 500 }
				}
			}
		}
	}
};

/** One entry the model proposes. */
export interface FoundTerm {
	term: string;
	category: string;
	definition: string;
	relevance: string;
	source: string;
	quote: string;
}

/** One batch's draft, with the guardrails that stopped it, if any. */
interface ScanResult extends ScanDraft {
	refusals: Refusal[];
}

/**
 * Split notes into the batches a scan reads them in, keeping their order:
 * each batch holds at most `FIND_CHARS` of text, counting each note as at
 * most `FIND_NOTE_CHARS`, except that a batch always takes at least one
 * note. `chars` is how much text a note has; a note with none is left out.
 * Pure.
 */
export function batchNotes(notes: Array<{ path: string; chars: number }>): string[][] {
	const batches: string[][] = [];
	let current: string[] = [];
	let chars = 0;
	for (const note of notes) {
		const size = Math.min(note.chars, FIND_NOTE_CHARS);
		if (size <= 0) continue;
		if (current.length && chars + size > FIND_CHARS) {
			batches.push(current);
			current = [];
			chars = 0;
		}
		current.push(note.path);
		chars += size;
	}
	if (current.length) batches.push(current);
	return batches;
}

/**
 * What a scan of this glossary would read now: its `sources:` and
 * `scanned:`, and the notes under the sources in batches (see `batchNotes`),
 * both every note and only those changed since the last full scan.
 *
 * A note counts as changed when the local day of its modified time is
 * `scanned` or later: the day is a label, so a note edited on the day of a
 * scan is read again rather than missed. With no `scanned`, every note is
 * changed. Reads each note under the sources; never writes, never runs a
 * model.
 */
export async function scanPlan(vault: Vault, glossary: GlossaryRef): Promise<ScanPlan> {
	const { sources, scanned } = scanSettings((await vault.read(glossary.path)).content);
	const notes: Array<{ path: string; chars: number; day: string }> = [];
	for (const path of await scanNotes(vault, sources)) {
		const note = await vault.read(path);
		notes.push({ path, chars: note.content.trim() ? note.content.length : 0, day: today(new Date(note.mtimeMs)) });
	}
	const batches = (list: typeof notes): ScanBatches => ({ notes: list.filter((n) => n.chars > 0).length, batches: batchNotes(list) });
	const all = batches(notes);
	return { sources, scanned, all, changed: scanned ? batches(notes.filter((n) => n.day >= scanned)) : all };
}

/**
 * The prompt for finding terms. Pure. `known` is the terms the glossary has
 * and those earlier batches found, listed so the model does not spend its
 * answer on them, and the categories so new entries reuse them; both are
 * checked again afterwards regardless.
 */
export function findPrompt(input: { glossary: string; known: string[]; categories: string[]; sources: Source[] }): string {
	return [
		`Find technical terms in the notes below for the user's "${input.glossary}" glossary.`,
		'A term is worth an entry when a note defines it, or uses it as a term of art a reader would need explained.',
		'Skip everyday words, names of people, and every term the glossary already has or that was already found:',
		input.known.length ? input.known.join('; ') : '(none yet)',
		'',
		'For each term give:',
		'- term: spelled as the note spells it',
		`- category: one or two words grouping it${input.categories.length ? `, reusing one of these where it fits: ${input.categories.join(', ')}` : ''}`,
		'- definition: two or three plain sentences saying what it is, claiming only what the notes support',
		`- relevance: one sentence on why it matters for ${input.glossary}, from the notes`,
		'- source: the path of the note it came from, exactly as given in its path attribute',
		'- quote: one sentence copied word for word from that note, containing the term',
		`At most ${FIND_LIMIT} terms. Fewer, better entries beat many; an empty list is a fine answer.`,
		'',
		wrapAsData(input.sources)
	].join('\n');
}

/**
 * Split proposed entries into those the notes support and those they do
 * not, and leave out any the glossary already has.
 *
 * Support means the entry's `source` is one of the notes that was sent, its
 * quote is found in that note's text as sent, and the term is named in the
 * quote, all compared on words (see `words`). A term is named when the quote
 * holds the whole term, the part before a bracket ("Traits" of "Traits
 * (Rust)"), the part inside it ("MSE" of "Mean Squared Error (MSE)"), or
 * either side of a slash ("Async/Await"), in the singular or the plural. The
 * quote itself must still be the note's own words. A term already in `known`, or
 * proposed twice, is neither: it is left out without counting as dropped.
 * Pure. Exported because this is the rule the feature exists to enforce.
 */
export function groundTerms(found: FoundTerm[], sources: Source[], known: string[]): { supported: FoundTerm[]; dropped: FoundTerm[] } {
	const seen = new Set(known.map(normaliseTerm));
	const text = new Map(sources.map((s) => [s.path, words(s.text)]));
	const supported: FoundTerm[] = [];
	const dropped: FoundTerm[] = [];
	for (const entry of found) {
		const key = normaliseTerm(entry.term);
		if (!key || seen.has(key)) continue;
		const note = text.get(entry.source.trim());
		const quote = words(entry.quote);
		const term = words(entry.term);
		const ok = Boolean(note) && quote.trim() !== '' && term.trim() !== '' && note!.includes(quote) && names(quote, entry.term);
		if (ok) {
			seen.add(key);
			supported.push(entry);
		} else dropped.push(entry);
	}
	return { supported, dropped };
}

/** Whether `quote` (already `words`-normalised) names `term`; see `groundTerms`. */
function names(quote: string, term: string): boolean {
	const bracket = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(term);
	const forms = [term, ...(bracket ? [bracket[1], bracket[2]] : []), ...term.split('/')];
	const singular = (text: string) => text.replace(/([a-z0-9]{3,})s(?= )/g, '$1');
	const said = singular(quote);
	return forms.some((form) => {
		const w = words(form);
		return w.trim() !== '' && said.includes(singular(w));
	});
}

/**
 * Draft one batch of a scan: read the notes `paths` names, ask Claude for
 * new terms in them, and return the candidates the notes support (see
 * `groundTerms`) and those left out.
 *
 * Only a note under the glossary's `sources:` as the file says now is read,
 * whatever the page sent; others and repeats are ignored, and so is an empty
 * note. The notes are read in the order given, each at most
 * `FIND_NOTE_CHARS`, until `FIND_CHARS` is reached. `found` is the terms
 * earlier batches turned up, as the page holds them: they are named to the
 * model (the first thousand) and left out of the answer like the glossary's
 * own terms (all of them). A glossary that is gone, or that names no
 * folders, or paths none of which it may read, is a problem to show, not an
 * error; so is a model that refused or was over budget.
 *
 * Side effects: reads the glossary and the notes, spawns the CLI read-only,
 * appends to the audit log. Never writes a note, and proposes no edit: the
 * candidates go to a person, and `addScannedTerms` writes the ones they keep.
 */
export async function draftScan(vault: Vault, glossary: GlossaryRef, input: { paths: unknown; found: unknown }, options: DraftOptions = {}): Promise<ScanResult> {
	const none = (problem: string | null, refusals: Refusal[] = [], read: string[] = []): ScanResult => ({ candidates: [], leftOut: [], read, problem, refusals });
	const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

	const current = await vault.read(glossary.path);
	if (!current.exists) return none('That glossary is not there any more.');
	const { sources: folders } = scanSettings(current.content);
	if (folders.length === 0) return none('Add a folder for this glossary to be scanned from first.');
	const allowed = new Set(await scanNotes(vault, folders));
	const paths = [...new Set(strings(input.paths))].filter((p) => allowed.has(p));
	if (paths.length === 0) return none('None of these notes is under the folders this glossary is scanned from.');

	const sources: Source[] = [];
	let chars = 0;
	for (const path of paths) {
		const text = (await vault.read(path)).content.slice(0, FIND_NOTE_CHARS);
		if (!text.trim()) continue;
		if (sources.length && chars + text.length > FIND_CHARS) break;
		sources.push({ path, text });
		chars += text.length;
	}
	const read = sources.map((s) => s.path);
	if (sources.length === 0) return none(null);

	const entries = parseGlossary(current.content);
	const known = entries.map((e) => e.term);
	const found = strings(input.found);
	const categories = [...new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c)))];

	const run = await runDraft<{ entries: FoundTerm[] }>(vault, {
		feature: 'glossary-lookup',
		prompt: findPrompt({ glossary: glossary.name, known: [...known, ...found.slice(0, FOUND_LIMIT)], categories, sources }),
		system:
			'You find technical terms in one person\'s notes for their glossary. Answer only with JSON: ' +
			'{"entries":[{"term":"…","category":"…","definition":"…","relevance":"…","source":"<path>","quote":"<sentence from that note>"}]}. ' +
			'Every entry must come from a note given; if the notes do not support an entry, do not write it.',
		schema: FIND_SCHEMA,
		paths: [glossary.path, ...read],
		cli: options.cli
	});
	if (!run.ok) return none(run.result.problem ?? 'Claude did not answer.', run.result.refusals, read);

	const { supported, dropped } = groundTerms(run.value.entries, sources, [...known, ...found]);
	const candidate = (f: FoundTerm): ScanCandidate => {
		const source = f.source.trim();
		return {
			term: f.term.trim(),
			category: (f.category ?? '').trim(),
			definition: f.definition.trim(),
			relevance: (f.relevance ?? '').trim(),
			source,
			note: basename(source),
			quote: f.quote.trim()
		};
	};
	return { candidates: supported.map(candidate), leftOut: dropped.map(candidate), read, problem: null, refusals: [] };
}


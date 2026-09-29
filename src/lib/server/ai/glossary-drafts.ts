/**
 * What Claude drafts for a glossary: definitions for the terms waiting to be
 * looked up, and new entries for terms found in a folder of notes.
 *
 * Each draft is a proposal and nothing more, with one destination: the
 * glossary's own file in `Glossaries/`. The model is given the notes as data
 * (G8), answers in a fixed JSON shape (G6), and the bytes it would change are
 * computed here from that answer and the glossary as it stands, through the
 * grammar in `parse/glossary.ts`. Nothing in this file writes to the vault;
 * `proposal.apply` does, after a human accepts. Both drafts run with the
 * glossary look-up's model settings and path policy (`glossary-lookup`).
 *
 * ## Finding terms, and the rule that shapes it
 *
 * "Find terms in my notes" reads the markdown notes under a folder the user
 * picks, in path order, until `FIND_CHARS` of text is gathered (each note at
 * most `FIND_NOTE_CHARS`), and says how far it got, so a big folder is read
 * in batches the user steps through, or narrowed. The model proposes
 * entries, each naming the note it came from and quoting a sentence of it.
 * As in `suggest-cards.ts`, an entry is kept only when its quote is found in
 * that note and the term is found in its quote; everything else is dropped
 * before it becomes an edit, because a prompt is a request and this is a
 * rule. Terms the glossary already has are skipped the same way, whatever
 * the model was told.
 *
 * The prompt builders and proposal builders are pure and exported, because
 * they are the part worth testing.
 */

import { config } from '../config';
import type { Vault } from '../vault/index';
import { basename } from '../parse/note';
import { appendEntry, findEntry, insertDefinition, normaliseTerm, parseGlossary, setField, type GlossaryEntry } from '../parse/glossary';
import { GLOSSARY_FOLDER, type GlossaryRef } from '../glossary';
import { loadMeetings, notebookPaths } from '../meetings';
import { wrapAsData, type Schema } from './guardrails';
import { asSource, gather, nothing, runDraft, type DraftOptions, type DraftResult, type Source } from './meeting-drafts';
import { newId } from './proposal';
import { words } from './suggest-cards';
import type { Proposal, RunStamp } from '$lib/shared/ai';

/** Terms looked up in one run; more is a second press. */
export const LOOKUP_LIMIT = 20;

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

export interface Lookup {
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

/* --------------------------------------------------------- find terms -- */

/** How much note text one "find terms" run reads, in characters. */
export const FIND_CHARS = 60_000;
/** How much of any one note it reads. */
export const FIND_NOTE_CHARS = 12_000;
/** New entries one run may propose. */
export const FIND_LIMIT = 25;

const FIND_SCHEMA: Schema = {
	type: 'object',
	fields: {
		entries: {
			type: 'array',
			maxItems: FIND_LIMIT,
			of: {
				type: 'object',
				fields: {
					term: { type: 'string', minLength: 1, maxLength: 120 },
					category: { type: 'string', maxLength: 60 },
					definition: { type: 'string', minLength: 1, maxLength: 1500 },
					relevance: { type: 'string', maxLength: 600 },
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

/** How much of a folder one run read. */
export interface FindBatch {
	/** The folder asked for, vault-relative; '' is the whole vault. */
	folder: string;
	/** Index of the first note read, in path order. */
	from: number;
	/** Notes read this run, empty ones included. */
	read: number;
	/** Notes under the folder altogether. */
	total: number;
	/** Characters of note text sent. */
	chars: number;
	/** Where the next batch starts, or null when this one reached the end. */
	next: number | null;
}

/** A "find terms" draft: a proposal or why not, how far it read, and what it dropped. */
export interface FindResult extends DraftResult {
	batch: FindBatch | null;
	/** Terms dropped because the note they named does not support them. */
	dropped: string[];
}

/**
 * The markdown notes a "find terms" run may read under `folder`, sorted by
 * path: public notes only (never the private folder), leaving out the hub's
 * own files and the glossaries themselves. `folder` is vault-relative with
 * or without slashes at either end; '' is the whole vault. Reads the listing
 * only.
 */
export async function notesUnder(vault: Vault, folder: string): Promise<string[]> {
	const root = cleanFolder(folder);
	return (await vault.list()).filter((p) => (!root || p.startsWith(`${root}/`)) && !skipped(p));
}

/**
 * Every folder that holds a note a "find terms" run could read, directly or
 * below, sorted: the suggestions for its folder field. Reads the listing
 * only.
 */
export async function noteFolders(vault: Vault): Promise<string[]> {
	const out = new Set<string>();
	for (const path of await vault.list()) {
		if (skipped(path)) continue;
		const parts = path.split('/').slice(0, -1);
		for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
	}
	return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * The prompt for finding terms. Pure. The terms the glossary has are listed
 * so the model does not spend its answer on them, and its categories so new
 * entries reuse them; both are checked again afterwards regardless.
 */
export function findPrompt(input: { glossary: string; known: string[]; categories: string[]; sources: Source[] }): string {
	return [
		`Find technical terms in the notes below for the user's "${input.glossary}" glossary.`,
		'A term is worth an entry when a note defines it, or uses it as a term of art a reader would need explained.',
		'Skip everyday words, names of people, and every term the glossary already has:',
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
 * The found terms as one proposal: each appended as a new entry, status
 * looked-up, with its category, `source:: [[<note>]]` and `drafted:: Claude`,
 * then its definition and `→` line. Pure. Every byte already in the glossary
 * stays; the entries go at the end. A term the glossary already has, or one
 * whose heading would not read back as that term, is skipped. A `revise`
 * pinned to the hash read, or a `create` when the file is not there. Null
 * when nothing is left to add.
 */
export function findProposal(
	path: string,
	glossary: { content: string; hash: string; exists: boolean },
	found: FoundTerm[],
	stamp: RunStamp
): Proposal | null {
	let text = glossary.content;
	let added = 0;
	for (const f of found) {
		if (findEntry(text, f.term)) continue;
		const appended = appendEntry(text, { term: f.term, status: 'looked-up', category: f.category, source: `[[${basename(f.source)}]]` });
		const heading = findEntry(appended, f.term);
		if (!heading) continue;
		const drafted = setField(appended, heading.term, 'drafted', 'Claude');
		const defined = drafted && insertDefinition(drafted, heading.term, f.definition, f.relevance);
		if (!defined) continue;
		text = defined;
		added++;
	}
	if (added === 0) return null;
	const reason = 'New entries, each defined from the note named as its source. Edit the text before accepting to drop any.';
	return {
		id: newId('terms'),
		feature: 'glossary-lookup',
		stamp,
		summary: `${added} new term${added === 1 ? '' : 's'} for ${basename(path)}.`,
		edits: [
			glossary.exists
				? { id: newId('edit'), kind: 'revise', path, text, expectedHash: glossary.hash, reason }
				: { id: newId('edit'), kind: 'create', path, text, reason }
		],
		accepted: []
	};
}

/**
 * Find terms for one glossary in the notes under `folder`, starting at the
 * `from`th note in path order: read up to `FIND_CHARS` of them, ask Claude,
 * and propose the entries the notes support (see `groundTerms`).
 *
 * Returns the batch read, so the caller can offer the next one, and the
 * terms dropped. A folder with no notes, or only empty ones, is a problem to
 * show, not an error. Side effects: reads notes, spawns the CLI read-only,
 * appends to the audit log. Never writes a note, and never proposes a
 * change to anything but the glossary's own file.
 */
export async function draftFoundTerms(
	vault: Vault,
	glossary: GlossaryRef,
	input: { folder: string; from?: number },
	options: DraftOptions = {}
): Promise<FindResult> {
	const destinations = [glossary.path];
	const folder = cleanFolder(input.folder);
	const where = folder ? `under ${folder}` : 'in the vault';
	const paths = await notesUnder(vault, folder);
	if (paths.length === 0) return { ...nothing(`There are no notes ${where}.`), destinations, batch: null, dropped: [] };

	const from = Math.min(Math.max(0, Math.floor(input.from ?? 0)), paths.length - 1);
	const sources: Source[] = [];
	let chars = 0;
	let i = from;
	while (i < paths.length) {
		const text = (await vault.read(paths[i])).content.slice(0, FIND_NOTE_CHARS);
		if (sources.length && chars + text.length > FIND_CHARS) break;
		i++;
		if (!text.trim()) continue;
		sources.push({ path: paths[i - 1], text });
		chars += text.length;
	}
	const batch: FindBatch = { folder, from, read: i - from, total: paths.length, chars, next: i < paths.length ? i : null };
	if (sources.length === 0) return { ...nothing(`The notes ${where} are empty.`), destinations, batch, dropped: [] };

	const current = await vault.read(glossary.path);
	const entries = parseGlossary(current.content);
	const known = entries.map((e) => e.term);
	const categories = [...new Set(entries.map((e) => e.category).filter((c): c is string => Boolean(c)))];

	const run = await runDraft<{ entries: FoundTerm[] }>(vault, {
		feature: 'glossary-lookup',
		prompt: findPrompt({ glossary: glossary.name, known, categories, sources }),
		system:
			'You find technical terms in one person\'s notes for their glossary. Answer only with JSON: ' +
			'{"entries":[{"term":"…","category":"…","definition":"…","relevance":"…","source":"<path>","quote":"<sentence from that note>"}]}. ' +
			'Every entry must come from a note given; if the notes do not support an entry, do not write it.',
		schema: FIND_SCHEMA,
		paths: [glossary.path, ...sources.map((s) => s.path)],
		cli: options.cli
	});
	if (!run.ok) return { ...run.result, destinations, batch, dropped: [] };

	const { supported, dropped } = groundTerms(run.value.entries, sources, known);
	const proposal = findProposal(glossary.path, current, supported, run.stamp);
	// With some dropped, the page says so; that is the whole answer then.
	const problem = proposal || dropped.length ? null : 'No new terms turned up in these notes.';
	return { proposal, problem, refusals: [], destinations, batch, dropped: dropped.map((d) => d.term) };
}

function cleanFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, '');
}

/** The hub's own files and the glossaries, which are not notes to mine. */
function skipped(path: string): boolean {
	return path.startsWith(`${config.hubFolder}/`) || path.startsWith(`${GLOSSARY_FOLDER}/`);
}

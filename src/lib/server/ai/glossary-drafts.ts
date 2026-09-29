/**
 * What Claude drafts for a glossary: definitions for the terms waiting to be
 * looked up.
 *
 * Each draft is a proposal and nothing more, with one destination: the
 * glossary's own file in `Glossaries/`. The model is given the notes as data
 * (G8), answers in a fixed JSON shape (G6), and the bytes it would change are
 * computed here from that answer and the glossary as it stands, through the
 * grammar in `parse/glossary.ts`. Nothing in this file writes to the vault;
 * `proposal.apply` does, after a human accepts, under the `glossary-lookup`
 * path policy.
 *
 * The prompt builders and proposal builders are pure and exported, because
 * they are the part worth testing.
 */

import type { Vault } from '../vault/index';
import { basename } from '../parse/note';
import { findEntry, insertDefinition, normaliseTerm, parseGlossary, setField, type GlossaryEntry } from '../parse/glossary';
import type { GlossaryRef } from '../glossary';
import { loadMeetings, notebookPaths } from '../meetings';
import { wrapAsData, type Schema } from './guardrails';
import { asSource, gather, nothing, runDraft, type DraftOptions, type DraftResult, type Source } from './meeting-drafts';
import { newId } from './proposal';
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

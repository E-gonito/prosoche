/**
 * Finding the notes that answer a question.
 *
 * The model is given text, never a filesystem, so the quality of an answer is
 * mostly this file's doing. The order is: narrow to the scope the user chose,
 * search it, add anything the question names outright by wiki-link, then trim
 * each note to the sections that actually bear on the question and stop when
 * the budget is spent.
 *
 * The bias throughout is towards fewer, longer passages. Twenty snippets of
 * forty words each read like a search results page and produce an answer that
 * sounds like one; four whole sections produce an answer that knows what the
 * note was about. Every passage carries its path, so the answer can cite what
 * it used and the user can go and check.
 */

import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';
import { parseNote } from '../parse/note';
import { estimateTokens, type Citation, type Scope } from '$lib/shared/ai';

export interface RetrievalDeps {
	index: NoteIndex;
	vault: Vault;
	workspaces: Workspace[];
}

export interface RetrievalRequest {
	question: string;
	scope: Scope;
	/** Roughly how many tokens of note text the prompt may carry. */
	tokenBudget?: number;
	/** Most notes to open, whatever the budget allows. */
	maxNotes?: number;
}

export interface Passage {
	path: string;
	title: string;
	/** The heading the passage sits under, or null for the top of a note. */
	heading: string | null;
	text: string;
}

export interface Retrieved {
	passages: Passage[];
	citations: Citation[];
	/** Estimated tokens the passages will cost. */
	tokens: number;
	/** How many notes matched before the budget cut the list short. */
	matched: number;
	/** True when something was dropped for want of budget. */
	truncated: boolean;
}

const DEFAULT_BUDGET = 12_000;
const DEFAULT_MAX_NOTES = 8;

/**
 * Gather the passages that bear on a question.
 *
 * Inputs: the index, the vault and the workspaces; the question and the scope
 * it is asked in. Output: passages with their paths, the citations for them,
 * and what it all costs. Side effects: reads notes and queries the index.
 * Never writes anything, and never returns a passage from outside the scope
 * the user chose - a question asked about one workspace cannot quietly pull
 * in a note from another.
 */
export async function retrieve(deps: RetrievalDeps, request: RetrievalRequest): Promise<Retrieved> {
	const budget = request.tokenBudget ?? DEFAULT_BUDGET;
	const maxNotes = request.maxNotes ?? DEFAULT_MAX_NOTES;
	const within = scopeFilter(request.scope, deps.workspaces);
	const terms = keyTerms(request.question);

	const candidates: string[] = [];
	const add = (path: string): void => {
		if (within(path) && !candidates.includes(path)) candidates.push(path);
	};

	// A question about "this note" is chiefly about that note.
	if (request.scope.kind === 'note') add(request.scope.path);
	// Anything the question names by wiki-link is wanted whether or not the
	// search ranks it, because naming a note is the strongest signal there is.
	for (const name of namedNotes(request.question)) {
		const resolved = deps.index.resolveLink(name);
		if (resolved) add(resolved);
	}
	for (const hit of deps.index.search(request.question, 60)) add(hit.path);

	const passages: Passage[] = [];
	let tokens = 0;
	let truncated = false;

	for (const path of candidates.slice(0, maxNotes)) {
		const note = await deps.vault.read(path);
		if (!note.exists) continue;
		const parsed = parseNote(note.content, path);
		const remaining = budget - tokens;
		if (remaining <= 0) {
			truncated = true;
			break;
		}
		for (const section of trimToRelevant(parsed.body, terms, remaining * 4)) {
			const cost = estimateTokens(section.text);
			if (tokens + cost > budget) {
				truncated = true;
				break;
			}
			tokens += cost;
			passages.push({ path, title: parsed.title, heading: section.heading, text: section.text });
		}
	}
	if (candidates.length > maxNotes) truncated = true;

	const citations: Citation[] = [];
	for (const passage of passages) {
		if (citations.some((c) => c.path === passage.path && c.heading === passage.heading)) continue;
		citations.push({ path: passage.path, title: passage.title, heading: passage.heading });
	}

	return { passages, citations, tokens, matched: candidates.length, truncated };
}

/**
 * A predicate for "is this note in scope".
 *
 * Exported because the scope rule is the one part of retrieval a user will
 * notice being wrong, and it deserves its own tests. Inputs: a scope and the
 * workspaces, for resolving a slug to its folders. Output: a predicate over
 * vault-relative paths. Side effects: none.
 *
 * A workspace whose slug does not exist matches nothing rather than
 * everything - the failure of a stale bookmark should be an empty answer, not
 * a search of the whole vault.
 */
export function scopeFilter(scope: Scope, workspaces: Workspace[]): (path: string) => boolean {
	switch (scope.kind) {
		case 'vault':
			return () => true;
		case 'note':
			return (path) => path === scope.path;
		case 'folder': {
			const prefix = scope.path.replace(/\/+$/, '');
			return (path) => path === prefix || path.startsWith(`${prefix}/`);
		}
		case 'workspace': {
			const workspace = workspaces.find((w) => w.slug === scope.slug);
			if (!workspace) return () => false;
			const folders = workspace.folders.map((f) => f.replace(/\/+$/, ''));
			if (folders.length === 0) return () => false;
			return (path) => folders.some((f) => path === f || path.startsWith(`${f}/`));
		}
	}
}

export interface Section {
	heading: string | null;
	text: string;
}

/**
 * Cut a note down to the parts that mention what was asked about.
 *
 * Inputs: the note body, the question's key terms, and a character budget.
 * Output: sections in file order, best-scoring first when the note is too
 * long to pass whole. Side effects: none - pure, so it is table-tested.
 *
 * A note that fits the budget is returned whole and unaltered, because
 * chopping a short note only loses context. A note that does not is split on
 * its headings and the sections that mention the terms are kept, each with
 * its heading, so the model sees "## Deployment" rather than an anonymous
 * paragraph. Never returns more than the budget, and never edits the text it
 * returns.
 */
export function trimToRelevant(body: string, terms: string[], maxChars: number): Section[] {
	const trimmed = body.trim();
	if (trimmed === '') return [];
	if (trimmed.length <= maxChars) return [{ heading: null, text: trimmed }];

	const sections = splitOnHeadings(trimmed);
	const scored = sections
		.map((section, order) => ({ section, order, score: score(section, terms) }))
		.filter((s) => s.score > 0 || sections.length === 1)
		.sort((a, b) => b.score - a.score || a.order - b.order);

	const kept: Array<{ section: Section; order: number }> = [];
	let used = 0;
	for (const item of scored) {
		const text = item.section.text.slice(0, maxChars);
		if (used + text.length > maxChars) continue;
		used += text.length;
		kept.push({ section: { heading: item.section.heading, text }, order: item.order });
	}
	if (kept.length === 0) {
		// Nothing matched a term. The opening of a note is usually what it is
		// about, so that is a better answer than nothing.
		return [{ heading: null, text: trimmed.slice(0, maxChars) }];
	}
	return kept.sort((a, b) => a.order - b.order).map((k) => k.section);
}

function splitOnHeadings(body: string): Section[] {
	const lines = body.split('\n');
	const sections: Section[] = [];
	let heading: string | null = null;
	let buffer: string[] = [];

	const flush = (): void => {
		const text = buffer.join('\n').trim();
		if (text !== '') sections.push({ heading, text: heading === null ? text : `${heading}\n${text}` });
		buffer = [];
	};

	for (const line of lines) {
		const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
		if (match) {
			flush();
			heading = line;
			continue;
		}
		buffer.push(line);
	}
	flush();
	return sections;
}

function score(section: Section, terms: string[]): number {
	const haystack = section.text.toLowerCase();
	let total = 0;
	for (const term of terms) {
		let from = 0;
		let hits = 0;
		for (;;) {
			const at = haystack.indexOf(term, from);
			if (at === -1) break;
			hits++;
			from = at + term.length;
			if (hits > 5) break;
		}
		// A heading match is worth more than a body match: it says the section
		// is about the thing, not that it mentions it in passing.
		if (section.heading && section.heading.toLowerCase().includes(term)) total += 5;
		total += hits;
	}
	return total;
}

const STOPWORDS = new Set([
	'the', 'and', 'for', 'what', 'when', 'where', 'which', 'with', 'this', 'that', 'from', 'have', 'has',
	'was', 'were', 'are', 'did', 'does', 'how', 'why', 'who', 'all', 'any', 'can', 'get', 'got', 'about',
	'into', 'out', 'not', 'but', 'you', 'your', 'our', 'their', 'there', 'they', 'been', 'over', 'last',
	'next', 'some', 'more', 'most', 'need', 'want', 'should', 'would', 'could', 'still', 'left', 'then'
]);

/** Words from the question worth matching on, lowercased and deduplicated. */
export function keyTerms(question: string): string[] {
	const words = question
		.toLowerCase()
		.replace(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g, ' $1 ')
		.split(/[^a-z0-9_-]+/)
		.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
	return [...new Set(words)].slice(0, 12);
}

/** Note names the question spells out as `[[wiki links]]`. */
export function namedNotes(question: string): string[] {
	const out: string[] = [];
	const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
	for (;;) {
		const match = pattern.exec(question);
		if (!match) break;
		const name = match[1].trim();
		if (name !== '' && !out.includes(name)) out.push(name);
	}
	return out;
}

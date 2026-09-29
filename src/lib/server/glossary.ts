/**
 * Glossaries: one per workspace, in `<home>/Glossary.md`: each term, what it
 * means, and why it matters to that workspace.
 *
 * The Glossary routes talk to this module. It owns where a workspace keeps
 * its glossary, which workspaces have one, and the writes a user's click
 * makes: starting a glossary, and adding, editing or deleting a term. Each
 * is an insertion, a span edit or the removal of one entry's lines through
 * the grammar in `parse/glossary.ts`; nothing here re-serialises a note.
 *
 * Any workspace with a folder can have a glossary, meetings or not. Terms
 * captured in a meeting reach it two ways: `meetings.ts` adds each one as it
 * is captured, and any that are still missing are offered by `loadGlossary`
 * from the list the caller passes in. This module never reads a meeting note
 * itself, so it does not depend on the notebook's layout.
 *
 * Nothing here writes on a model's behalf. Look-ups are proposals, in
 * `ai/meeting-drafts.ts`.
 */

import { appendEntry, deleteEntry, editEntry, findEntry, normaliseTerm, parseGlossary, type EntryChange, type GlossaryEntry } from './parse/glossary';
import { invalid, rewrite, type Written } from './rewrite';
import type { Workspace } from './workspaces';
import type { Vault } from './vault/index';

/** The title line a new glossary starts with. */
const TITLE = '# Glossary\n';

/** A term captured elsewhere, such as in a meeting, that could be added. */
export interface CapturedTerm {
	term: string;
	/** `[[<note name>]]`, as the glossary's `source::` wants it. */
	source: string;
	meeting: { path: string; title: string; date: string | null };
}

/** One glossary as read, with the terms it is missing. */
export interface Glossary {
	/** Null for a workspace with no folder, which has nowhere to keep one. */
	path: string | null;
	exists: boolean;
	content: string;
	entries: GlossaryEntry[];
	/** The captured terms offered, less any the glossary already has. */
	captured: CapturedTerm[];
}

/** A workspace and its glossary, for a list. */
export interface GlossarySummary {
	slug: string;
	name: string;
	color: string;
	/** Null for a workspace with no folder. */
	path: string | null;
	exists: boolean;
	terms: number;
	/** Entries still to look up. */
	pending: number;
}

/**
 * Where a workspace's glossary lives: `Glossary.md` in its first folder, or
 * null for a workspace with no folder. Pure.
 */
export function glossaryPath(workspace: Workspace): string | null {
	const home = workspace.folders[0]?.replace(/^\/+|\/+$/g, '');
	return home ? `${home}/Glossary.md` : null;
}

/**
 * Read a workspace's glossary, and which of `captured` it lacks.
 *
 * A missing Glossary.md, or a workspace with no folder, is an empty
 * glossary. `captured` is taken in the order given, newest first by
 * convention, and a term offered twice is kept once, from its first
 * appearance. Never writes.
 */
export async function loadGlossary(vault: Vault, workspace: Workspace, captured: CapturedTerm[] = []): Promise<Glossary> {
	const path = glossaryPath(workspace);
	if (!path) return { path: null, exists: false, content: '', entries: [], captured: [] };
	const note = await vault.read(path);
	const entries = parseGlossary(note.content);
	const known = new Set(entries.map((e) => normaliseTerm(e.term)));
	const missing: CapturedTerm[] = [];
	for (const term of captured) {
		const key = normaliseTerm(term.term);
		if (!key || known.has(key)) continue;
		known.add(key);
		missing.push(term);
	}
	return { path, exists: note.exists, content: note.content, entries, captured: missing };
}

/**
 * Every workspace with its glossary's size, in the order given, including
 * those without one yet so a list can offer to start it. Never writes.
 */
export async function listGlossaries(vault: Vault, workspaces: Workspace[]): Promise<GlossarySummary[]> {
	const out: GlossarySummary[] = [];
	for (const w of workspaces) {
		const { path, exists, entries } = await loadGlossary(vault, w);
		out.push({
			slug: w.slug,
			name: w.name,
			color: w.color,
			path,
			exists,
			terms: entries.length,
			pending: entries.filter((e) => e.pending).length
		});
	}
	return out;
}

/**
 * Create a workspace's Glossary.md holding only a title line. Refuses a
 * workspace with no folder, and never touches a glossary that already
 * exists, even an empty one.
 */
export async function startGlossary(vault: Vault, workspace: Workspace): Promise<Written> {
	const path = glossaryPath(workspace);
	if (!path) return invalid('This workspace has no folder to keep a glossary in.');
	return rewrite(vault, path, (content) => (content === '' ? TITLE : null), 1, {
		create: true,
		unchanged: 'This workspace already has a glossary.'
	});
}

/**
 * Append a new entry, status to-look-up, creating Glossary.md when there is
 * none. Refuses an empty term, a workspace with no folder, and a term the
 * glossary already has, rather than writing a second heading for it. A
 * clash with an edit made a moment earlier is retried once.
 */
export async function addTerm(
	vault: Vault,
	workspace: Workspace,
	term: { term: string; category?: string | null; source?: string | null }
): Promise<Written> {
	const path = glossaryPath(workspace);
	if (!path) return invalid('This workspace has no folder to keep a glossary in.');
	if (!term.term.trim()) return invalid('A term needs a name.');
	const key = normaliseTerm(term.term);
	return rewrite(
		vault,
		path,
		(content) => {
			if (parseGlossary(content).some((e) => normaliseTerm(e.term) === key)) return null;
			return appendEntry(content, { ...term, status: 'to-look-up' });
		},
		2,
		{ create: true, unchanged: 'That term is already in the glossary.' }
	);
}

/** An edit to one term, as the glossary page sends it. */
export interface TermEdit {
	term?: string;
	category?: string;
	definition?: string;
	relevance?: string;
}

/**
 * Edit one term: rename it, change its category, rewrite its definition and
 * `→` line. Giving a pending term a definition marks it looked up, since
 * that is what having one means.
 *
 * Refuses an unknown term, an empty new name, and a new name another entry
 * already has. Only the entry's own lines change (see `editEntry`). A clash
 * with an edit made a moment earlier is retried once, against the term by
 * name, so it cannot land on a different entry.
 */
export async function editTerm(vault: Vault, workspace: Workspace, term: string, edit: TermEdit): Promise<Written> {
	const path = glossaryPath(workspace);
	if (!path) return invalid('This workspace has no folder to keep a glossary in.');
	if (edit.term !== undefined && !edit.term.trim()) return invalid('A term needs a name.');
	const renamed = edit.term !== undefined && normaliseTerm(edit.term) !== normaliseTerm(term) ? edit.term : undefined;

	let problem = 'That term is not in the glossary any more.';
	const result = await rewrite(
		vault,
		path,
		(content) => {
			const entry = findEntry(content, term);
			if (!entry) return null;
			if (renamed && findEntry(content, renamed)) {
				problem = 'Another term already has that name.';
				return null;
			}
			const change: EntryChange = {};
			if (edit.term !== undefined) change.term = edit.term;
			if (edit.category !== undefined) change.category = edit.category;
			if (edit.definition !== undefined || edit.relevance !== undefined) {
				const definition = edit.definition ?? entry.definition;
				change.body = { definition, relevance: edit.relevance ?? entry.relevance ?? '' };
				if (definition.trim() && entry.pending) change.status = 'looked-up';
			}
			return editEntry(content, term, change);
		},
		2
	);
	// The change function said why it refused; `rewrite` only knows it did.
	return !result.ok && result.reason === 'invalid' ? invalid(problem) : result;
}

/**
 * Delete one term: its heading and every line of its entry. Refuses a term
 * the glossary does not have. Nothing else in the file changes.
 */
export async function deleteTerm(vault: Vault, workspace: Workspace, term: string): Promise<Written> {
	const path = glossaryPath(workspace);
	if (!path) return invalid('This workspace has no folder to keep a glossary in.');
	return rewrite(vault, path, (content) => deleteEntry(content, term), 2, { unchanged: 'That term is not in the glossary any more.' });
}

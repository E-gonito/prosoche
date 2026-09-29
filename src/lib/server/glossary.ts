/**
 * Glossaries: each term, what it means, and why it matters.
 *
 * A glossary is one file in `Glossaries/` at the vault root, and the file
 * name is its name: `Glossaries/Computer Science.md` is the glossary called
 * Computer Science, at `/glossary/computer-science`. Glossaries belong to no
 * workspace. A workspace whose definition says `glossary: <name>` sends the
 * terms captured in its meetings to that glossary, and any number of
 * workspaces may point at the same one.
 *
 * The Glossary routes talk to this module. It owns where glossaries live, how
 * a name becomes a file and a URL, which workspaces point at which glossary,
 * and the writes a user's click makes: creating, renaming and deleting a
 * glossary, and adding, editing or deleting a term. A term write is an
 * insertion, a span edit or the removal of one entry's lines through the
 * grammar in `parse/glossary.ts`; nothing here re-serialises a note.
 *
 * Terms captured in a meeting reach a glossary two ways: `meetings.ts` adds
 * each one as it is captured, and any that are still missing are offered by
 * `loadGlossary` from the list the caller passes in. This module never reads
 * a meeting note itself, so it does not depend on the notebook's layout.
 *
 * Nothing here writes on a model's behalf. Look-ups and "find terms" are
 * proposals, in `ai/glossary-drafts.ts`.
 */

import { config } from './config';
import { appendEntry, deleteEntry, editEntry, findEntry, normaliseTerm, parseGlossary, type EntryChange, type GlossaryEntry } from './parse/glossary';
import { contactName } from './parse/contact';
import { setFrontmatterField } from './parse/frontmatter';
import { conflict, invalid, rewrite, type Written } from './rewrite';
import { slugify } from '$lib/shared/slug';
import type { Workspace } from './workspaces';
import { hashContent, type Vault } from './vault/index';

/** The folder every glossary lives in, vault-relative. */
export const GLOSSARY_FOLDER = config.glossaryFolder;

/** The title line a new glossary starts with. */
const TITLE = '# Glossary\n';

/** The dot for a glossary no workspace points at; a workspace's default colour. */
const NEUTRAL = '#6b7280';

/** One glossary file, and the workspaces that send it their meetings' terms. */
export interface GlossaryRef {
	/** The file name without `.md`. */
	name: string;
	/** Unique among the glossaries: the URL segment, `/glossary/<slug>`. */
	slug: string;
	/** `Glossaries/<name>.md`. */
	path: string;
	/** Workspaces whose `glossary:` names this one, in the order given. */
	linked: Workspace[];
	/** The first linked workspace's colour, or a neutral grey. */
	color: string;
}

/** A term captured elsewhere, such as in a meeting, that could be added. */
export interface CapturedTerm {
	term: string;
	/** `[[<note name>]]`, as the glossary's `source::` wants it. */
	source: string;
	meeting: { path: string; title: string; date: string | null };
}

/** One glossary as read, with the terms it is missing. */
export interface Glossary {
	path: string;
	exists: boolean;
	content: string;
	entries: GlossaryEntry[];
	/** The captured terms offered, less any the glossary already has. */
	captured: CapturedTerm[];
}

/** A glossary and its size, for a list. */
export interface GlossarySummary {
	name: string;
	slug: string;
	color: string;
	terms: number;
	/** Entries still to look up. */
	pending: number;
	/** The workspaces pointing at it, by slug and name. */
	linked: Array<{ slug: string; name: string }>;
}

/**
 * Where the glossary called `name` lives: `Glossaries/<name>.md`, or null for
 * a name that could not stay inside that folder (empty, a slash, a leading
 * dot). Lenient on purpose, so a glossary made in Obsidian with a name
 * `createGlossary` would refuse is still found. Pure.
 */
export function glossaryPath(name: string): string | null {
	const clean = name.trim();
	if (!clean || /[\\/]/.test(clean) || clean.startsWith('.')) return null;
	return `${GLOSSARY_FOLDER}/${clean}.md`;
}

/** True for a markdown file directly inside `Glossaries/`. Pure. */
export function isGlossaryPath(path: string): boolean {
	const rest = path.startsWith(`${GLOSSARY_FOLDER}/`) ? path.slice(GLOSSARY_FOLDER.length + 1) : '';
	return rest.length > 3 && rest.endsWith('.md') && !rest.includes('/') && !rest.startsWith('.');
}

/**
 * True when a workspace's `glossary:` names the glossary called `name`:
 * compared ignoring case and repeated spaces, as Obsidian resolves a link.
 * Pure.
 */
export function pointsAt(workspace: Workspace, name: string): boolean {
	return Boolean(workspace.glossary) && sameName(workspace.glossary!, name);
}

/**
 * Every glossary in `Glossaries/`, sorted by name, each with the workspaces
 * that point at it. Reads the folder only, never the files, so it is cheap
 * enough for the rail on every page.
 *
 * Slugs are unique: two names that slug alike (`C++` and `C`, made in
 * Obsidian) get `c` and `c-2` in name order, and a name with no letters or
 * digits gets `glossary`. Never writes.
 */
export async function glossaries(vault: Vault, workspaces: Workspace[]): Promise<GlossaryRef[]> {
	const names = (await vault.files(GLOSSARY_FOLDER, 'md'))
		.filter((f) => !f.startsWith('.'))
		.map((f) => f.slice(0, -3))
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	const taken = new Set<string>();
	return names.map((name) => {
		const base = slugify(name) || 'glossary';
		let slug = base;
		for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
		taken.add(slug);
		const linked = workspaces.filter((w) => pointsAt(w, name));
		return { name, slug, path: `${GLOSSARY_FOLDER}/${name}.md`, linked, color: linked[0]?.color ?? NEUTRAL };
	});
}

/** The glossary at `/glossary/<slug>`, or null. Never writes. */
export async function findGlossary(vault: Vault, workspaces: Workspace[], slug: string): Promise<GlossaryRef | null> {
	return (await glossaries(vault, workspaces)).find((g) => g.slug === slug) ?? null;
}

/**
 * The glossary a workspace's meetings capture into: the existing glossary its
 * `glossary:` names (ignoring case), or, when there is none yet, where one by
 * that name would go, so the first captured term creates it. Null for a
 * workspace with no `glossary:`, or one naming something that cannot be a
 * file in `Glossaries/`. Never writes.
 */
export async function glossaryOf(vault: Vault, workspace: Workspace): Promise<{ name: string; path: string } | null> {
	if (!workspace.glossary) return null;
	const found = (await glossaries(vault, [workspace])).find((g) => g.linked.length > 0);
	if (found) return { name: found.name, path: found.path };
	const path = glossaryPath(workspace.glossary);
	return path ? { name: workspace.glossary.trim(), path } : null;
}

/**
 * Every glossary with its size and the workspaces pointing at it, sorted by
 * name. Reads each file. Never writes.
 */
export async function listGlossaries(vault: Vault, workspaces: Workspace[]): Promise<GlossarySummary[]> {
	const out: GlossarySummary[] = [];
	for (const g of await glossaries(vault, workspaces)) {
		const entries = parseGlossary((await vault.read(g.path)).content);
		out.push({
			name: g.name,
			slug: g.slug,
			color: g.color,
			terms: entries.length,
			pending: entries.filter((e) => e.pending).length,
			linked: g.linked.map((w) => ({ slug: w.slug, name: w.name }))
		});
	}
	return out;
}

/**
 * Read one glossary, and which of `captured` it lacks.
 *
 * A missing file is an empty glossary. `captured` is taken in the order
 * given, newest first by convention, and a term offered twice is kept once,
 * from its first appearance. Never writes.
 */
export async function loadGlossary(vault: Vault, path: string, captured: CapturedTerm[] = []): Promise<Glossary> {
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
 * Create `Glossaries/<name>.md` holding only a title line.
 *
 * Refuses a name that cannot be a file name or a wikilink (the rule a
 * contact's name follows: no slash, colon, `#`, `^` or brackets, no leading
 * or trailing dot), one with no letter or digit to make a URL of, and one
 * another glossary already has, ignoring case, or that would share its URL,
 * so the new glossary's slug is always `slugify(name)`. Never overwrites: a
 * file that appears between the check and the write is refused the same way.
 */
export async function createGlossary(vault: Vault, rawName: string): Promise<Written> {
	const checked = await freeName(vault, rawName, null);
	if (!checked.ok) return checked;
	const written = await vault.write(checked.path, TITLE, hashContent(''));
	return written.ok ? { ok: true, path: checked.path } : invalid(TAKEN);
}

/**
 * Rename a glossary: write its bytes, unchanged, to `Glossaries/<new name>.md`,
 * remove the old file, and repoint every workspace whose `glossary:` named
 * it, each through a span edit of that one frontmatter line.
 *
 * Refuses a name `createGlossary` would refuse, and so never overwrites
 * another glossary. A name that differs only in case or spacing from the old
 * one is a real rename. The old file is removed only if it still has the
 * bytes that were copied; if it changed in the meantime the copy is taken
 * back and a conflict returned, so nothing is lost or doubled. A workspace
 * file that cannot be repointed keeps the old name; the glossary is still
 * renamed. Renaming to the very same name writes nothing.
 */
export async function renameGlossary(vault: Vault, glossary: GlossaryRef, rawName: string): Promise<Written> {
	const name = contactName(rawName);
	if (name === glossary.name) return { ok: true, path: glossary.path };
	const checked = await freeName(vault, rawName, glossary.path);
	if (!checked.ok) return checked;

	const old = await vault.read(glossary.path);
	if (!old.exists) return { ok: false, reason: 'not-found', message: 'That glossary is not there any more.' };
	const copied = await vault.write(checked.path, old.content, hashContent(''));
	if (!copied.ok) return invalid(TAKEN);
	const removed = await vault.remove(glossary.path, old.hash);
	if (!removed.ok) {
		await vault.remove(checked.path, copied.note.hash);
		return conflict();
	}

	for (const w of glossary.linked) {
		await rewrite(vault, w.path, (content) => setFrontmatterField(content, 'glossary', checked.name), 2);
	}
	return { ok: true, path: checked.path };
}

/**
 * Delete a glossary: remove its one file through `vault.remove`, which
 * commits the deletion, so git history still has it. Workspaces that point
 * at it keep their `glossary:` line, and the next term captured in their
 * meetings starts it again. Refuses a glossary that is not there.
 */
export async function deleteGlossary(vault: Vault, glossary: GlossaryRef): Promise<Written> {
	const removed = await vault.remove(glossary.path);
	return removed.ok ? { ok: true, path: glossary.path } : { ok: false, reason: 'not-found', message: 'That glossary is not there any more.' };
}

/**
 * Append a new entry, status to-look-up, to the glossary at `path`, creating
 * the file when there is none. `path` is one this module gave out. Refuses
 * an empty term, and a term the glossary already has rather than writing a
 * second heading for it. A clash with an edit made a moment earlier is
 * retried once.
 */
export async function addTerm(vault: Vault, path: string, term: { term: string; category?: string | null; source?: string | null }): Promise<Written> {
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
 * Edit one term of the glossary at `path`: rename it, change its category,
 * rewrite its definition and `→` line. Giving a pending term a definition
 * marks it looked up, since that is what having one means.
 *
 * Refuses an unknown term, an empty new name, and a new name another entry
 * already has. Only the entry's own lines change (see `editEntry`). A clash
 * with an edit made a moment earlier is retried once, against the term by
 * name, so it cannot land on a different entry.
 */
export async function editTerm(vault: Vault, path: string, term: string, edit: TermEdit): Promise<Written> {
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
 * Delete one term of the glossary at `path`: its heading and every line of
 * its entry. Refuses a term the glossary does not have. Nothing else in the
 * file changes.
 */
export async function deleteTerm(vault: Vault, path: string, term: string): Promise<Written> {
	return rewrite(vault, path, (content) => deleteEntry(content, term), 2, { unchanged: 'That term is not in the glossary any more.' });
}

const TAKEN = 'There is already a glossary with that name.';

/**
 * A name a new or renamed glossary may take, and its path. `except` is the
 * glossary being renamed, which does not count as taking its own name.
 */
async function freeName(vault: Vault, rawName: string, except: string | null): Promise<{ ok: true; name: string; path: string } | Extract<Written, { ok: false }>> {
	const name = contactName(rawName);
	if (!name) return { ok: false, reason: 'invalid', message: 'A glossary name cannot be empty or hold a slash, colon, #, ^ or brackets.' };
	if (!slugify(name)) return { ok: false, reason: 'invalid', message: 'A glossary name needs a letter or a digit.' };
	const others = (await glossaries(vault, [])).filter((g) => g.path !== except);
	const slug = slugify(name);
	if (others.some((g) => sameName(g.name, name) || slugify(g.name) === slug || g.slug === slug)) return { ok: false, reason: 'invalid', message: TAKEN };
	return { ok: true, name, path: `${GLOSSARY_FOLDER}/${name}.md` };
}

function sameName(a: string, b: string): boolean {
	return normaliseTerm(a) === normaliseTerm(b);
}

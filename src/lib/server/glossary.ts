/**
 * Glossaries: each term, what it means, and why it matters.
 *
 * A glossary is one file in `Glossaries/` at the vault root, and the file
 * name is its name: `Glossaries/Computer Science.md` is the glossary called
 * Computer Science, at `/glossary/computer-science`. Glossaries belong to no
 * workspace. A workspace whose definition says `glossary: <name>` is linked
 * to it, and any number of workspaces may point at the same one.
 *
 * The Glossary routes talk to this module. It owns where glossaries live, how
 * a name becomes a file and a URL, which workspaces point at which glossary,
 * and the writes a user's click makes: creating, renaming and deleting a
 * glossary, and adding, editing or deleting a term. A term write is an
 * insertion, a span edit or the removal of one entry's lines through the
 * grammar in `parse/glossary.ts`; nothing here re-serialises a note.
 *
 * A glossary may name the study subject its terms become flashcards in,
 * `study: <subject slug>`, set here by `setGlossaryStudy` the same way. The
 * cards themselves are `study/glossary-cards.ts`'s business; this module
 * only reads and writes the link.
 *
 * A glossary may also name, in its frontmatter, the folders of notes it is
 * scanned for new terms (`sources:`) and the day of its last full scan
 * (`scanned:`). Both are written here as span edits of their own lines,
 * through `setFrontmatterField`; the body is never re-serialised.
 *
 *     ---
 *     sources:
 *       - Computer Science
 *     scanned: "2026-09-29"
 *     study: cs-study
 *     ---
 *
 * Nothing here writes on a model's behalf. Look-ups are proposals and a scan
 * is a list of candidates, both drafted in `ai/glossary-drafts.ts`; the
 * candidates a person keeps come back through `addScannedTerms`, which is
 * the accept step and trusts nothing it is sent.
 */

import { config } from './config';
import { appendEntry, deleteEntry, editEntry, findEntry, insertDefinition, normaliseTerm, parseGlossary, setField, type EntryChange, type GlossaryEntry } from './parse/glossary';
import { contactName } from './parse/contact';
import { setFrontmatterField } from './parse/frontmatter';
import { basename, parseNote } from './parse/note';
import { isDayKey } from './daily';
import { ENTRY_LIMITS, MAX_NEW_ENTRIES, type ScannedEntry } from '$lib/shared/glossary';
import { conflict, invalid, rewrite, type Written } from './rewrite';
import { slugify } from '$lib/shared/slug';
import { subjectsOf } from './study/subjects';
import type { Workspace } from './workspaces';
import { hashContent, type Vault } from './vault/index';

/** The folder every glossary lives in, vault-relative. */
export const GLOSSARY_FOLDER = config.glossaryFolder;

/** The title line a new glossary starts with. */
const TITLE = '# Glossary\n';

/** The dot for a glossary no workspace points at; a workspace's default colour. */
const NEUTRAL = '#6b7280';

/** One glossary file, and the workspaces that point at it. */
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

/** One glossary as read. */
export interface Glossary {
	path: string;
	exists: boolean;
	content: string;
	entries: GlossaryEntry[];
}

/** A glossary and its size, for a list. */
interface GlossarySummary {
	name: string;
	slug: string;
	color: string;
	terms: number;
	/** Entries still to look up. */
	pending: number;
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
function pointsAt(workspace: Workspace, name: string): boolean {
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
			pending: entries.filter((e) => e.pending).length
		});
	}
	return out;
}

/** Read one glossary. A missing file is an empty glossary. Never writes. */
export async function loadGlossary(vault: Vault, path: string): Promise<Glossary> {
	const note = await vault.read(path);
	return { path, exists: note.exists, content: note.content, entries: parseGlossary(note.content) };
}

/**
 * The study subject a glossary's terms become cards in: its frontmatter's
 * `study:`, trimmed, or null when there is none or it is not a string. It is
 * a subject's slug, but this does not check that the subject exists. Pure.
 */
export function studyLink(content: string): string | null {
	const study = parseNote(content).frontmatter.study;
	return typeof study === 'string' && study.trim() ? study.trim() : null;
}

/**
 * Link a glossary to the study subject `slug`, or unlink it with `''`, by
 * setting its frontmatter's `study:` through `setFrontmatterField`: only that
 * key's line changes, and a glossary without frontmatter gains a minimal
 * block. Unlinking leaves an empty `study:` in place and the cards where
 * they are.
 *
 * Refuses anything but a string, and a slug that is not a study subject's
 * among `workspaces`. A clash with an edit made a moment earlier is retried
 * once. Never touches the glossary's body or its cards.
 */
export async function setGlossaryStudy(vault: Vault, glossary: GlossaryRef, workspaces: Workspace[], slug: unknown): Promise<Written> {
	if (typeof slug !== 'string') return invalid('Send the study subject as its slug.');
	const wanted = slug.trim();
	if (wanted && !subjectsOf(workspaces).some((s) => s.slug === wanted)) return invalid(`There is no study subject “${wanted}”.`);
	return rewrite(vault, glossary.path, (content) => setFrontmatterField(content, 'study', wanted), 2);
}

/**
 * The glossaries linked to the study subject `subject`, by name and slug,
 * in name order: those whose `study:` names it. Reads each glossary. Never
 * writes.
 */
export async function glossariesFor(vault: Vault, workspaces: Workspace[], subject: string): Promise<Array<{ name: string; slug: string }>> {
	const out: Array<{ name: string; slug: string }> = [];
	for (const g of await glossaries(vault, workspaces)) {
		if (studyLink((await vault.read(g.path)).content) === subject) out.push({ name: g.name, slug: g.slug });
	}
	return out;
}

/* -------------------------------------------------------------- scan -- */

/**
 * Where a glossary is scanned for new terms, and when it last was, read from
 * its frontmatter. Pure; never throws.
 *
 * `sources:` is a list of vault folders, or one folder written as a string;
 * each is trimmed of spaces and slashes at either end, empty ones and repeats
 * are dropped, and the order is kept. Anything else reads as no sources.
 * `scanned:` is a `YYYY-MM-DD` day, quoted or not; anything else reads as
 * null, as if the glossary had never been scanned.
 */
export function scanSettings(content: string): { sources: string[]; scanned: string | null } {
	const fm = parseNote(content).frontmatter;
	const raw: unknown[] = Array.isArray(fm.sources) ? fm.sources : typeof fm.sources === 'string' ? [fm.sources] : [];
	const sources = [...new Set(raw.filter((s): s is string => typeof s === 'string').map(cleanFolder).filter(Boolean))];
	const s = fm.scanned;
	const day = s instanceof Date && !Number.isNaN(s.getTime()) ? s.toISOString().slice(0, 10) : typeof s === 'string' ? s.trim() : '';
	return { sources, scanned: isDayKey(day) ? day : null };
}

/**
 * Every folder that holds a note a scan could read, directly or below,
 * sorted: what a glossary's `sources:` may name. Public folders only, never
 * the hub's own or `Glossaries/`. Reads the listing only.
 */
export async function noteFolders(vault: Vault): Promise<string[]> {
	return (await vault.folders()).filter((f) => !notScanned(`${f}/`));
}

/**
 * The markdown notes under any of `folders`, sorted by path, each once: the
 * notes a scan of those folders may read. Public notes only (never the
 * private folder), leaving out the hub's own files and the glossaries
 * themselves. Folders are vault-relative, with or without slashes at either
 * end; an empty one names nothing, not the whole vault. Reads the listing
 * only.
 */
export async function scanNotes(vault: Vault, folders: string[]): Promise<string[]> {
	const roots = folders.map(cleanFolder).filter(Boolean);
	if (roots.length === 0) return [];
	return (await vault.list()).filter((p) => !notScanned(p) && roots.some((r) => p.startsWith(`${r}/`)));
}

/**
 * Set the folders a glossary is scanned for new terms: its frontmatter's
 * `sources:`, written through `setFrontmatterField` as a list, so only that
 * key's lines change and a glossary without frontmatter gains a minimal
 * block. An empty list clears the key's value.
 *
 * Refuses anything but a list of strings, more than twenty folders, and a
 * folder `noteFolders` does not offer; a repeat is written once. A clash
 * with an edit made a moment earlier is retried once. Never touches the
 * glossary's body.
 */
export async function setGlossarySources(vault: Vault, glossary: GlossaryRef, folders: unknown): Promise<Written> {
	if (!Array.isArray(folders) || folders.some((f) => typeof f !== 'string')) return invalid('Send the folders as a list.');
	const wanted = [...new Set((folders as string[]).map(cleanFolder).filter(Boolean))];
	if (wanted.length > 20) return invalid('A glossary can be scanned from at most twenty folders.');
	const offered = new Set(await noteFolders(vault));
	const unknown = wanted.find((f) => !offered.has(f));
	if (unknown) return invalid(`“${unknown}” is not a folder of notes in the vault.`);
	return rewrite(vault, glossary.path, (content) => setFrontmatterField(content, 'sources', wanted), 2);
}

/** What adding scanned terms did, or why it did not. */
export type ScanAdded = { ok: true; path: string; added: number } | Extract<Written, { ok: false }>;

/**
 * Add the entries a person kept from a scan to the glossary, and, when the
 * scan read every note it meant to, set `scanned:` to `day`.
 *
 * The explicit accept step for drafted terms, so everything is checked again
 * here, whatever the page sent. The glossary must exist. `entries` must be a
 * list of at most `MAX_NEW_ENTRIES`, and may be empty only when `complete`
 * is true (a scan that found nothing still marks its notes scanned). Each
 * entry needs a term, every field within `ENTRY_LIMITS`; a `→` line only
 * with a definition; a term that reads back as its own heading; a term the
 * glossary does not have, compared with `normaliseTerm` against the file as
 * it is now, and that no other entry sent has; and a source that is empty
 * (a term typed in) or a markdown note under one of the glossary's
 * `sources:` (see `scanNotes`). Any failure refuses the lot, naming each
 * entry at fault, and writes nothing.
 *
 * The new text is built by `withScannedTerms`, which must read back as the
 * old entries unchanged plus exactly the new ones. Side effects: one write,
 * to the glossary's own file, guarded by the hash it read, so an edit made
 * meanwhile is a conflict and nothing is written. Never writes a note the
 * terms came from, and never changes a byte of the entries already there.
 */
export async function addScannedTerms(vault: Vault, glossary: GlossaryRef, input: { entries: unknown; complete: unknown }, day: string): Promise<ScanAdded> {
	const refuse = (message: string) => ({ ok: false as const, reason: 'invalid' as const, message });
	const note = await vault.read(glossary.path);
	if (!note.exists) return { ok: false, reason: 'not-found', message: 'That glossary is not there any more.' };

	const complete = input.complete === true;
	if (!Array.isArray(input.entries) || (input.entries.length === 0 && !complete)) return refuse('There are no terms to add.');
	if (input.entries.length > MAX_NEW_ENTRIES) return refuse(`At most ${MAX_NEW_ENTRIES} terms can be added at once.`);

	const allowed = new Set(await scanNotes(vault, scanSettings(note.content).sources));
	const known = new Set(parseGlossary(note.content).map((e) => normaliseTerm(e.term)));
	const sent = new Set<string>();
	const problems: string[] = [];
	const entries: ScannedEntry[] = [];
	for (const [i, raw] of (input.entries as Array<Record<string, unknown> | null>).entries()) {
		const text = (value: unknown) => (typeof value === 'string' ? value.trim() : null);
		const fields = { term: text(raw?.term), category: text(raw?.category ?? ''), definition: text(raw?.definition ?? ''), relevance: text(raw?.relevance ?? '') };
		const source = text(raw?.source ?? '');
		const name = fields.term ? `“${fields.term}”` : `Term ${i + 1}`;
		const { term, category, definition, relevance } = fields;
		if (term === null || category === null || definition === null || relevance === null || source === null) {
			problems.push(`${name} is not a glossary entry.`);
			continue;
		}
		const key = normaliseTerm(term);
		const tooLong = (Object.keys(ENTRY_LIMITS) as Array<keyof typeof ENTRY_LIMITS>).some((k) => fields[k]!.length > ENTRY_LIMITS[k]);
		if (!term) problems.push(`${name} needs a name.`);
		else if (tooLong) problems.push(`${name} is too long.`);
		else if (relevance && !definition) problems.push(`${name} has a → line but no definition.`);
		else if (!readsAsHeading(term)) problems.push(`${name} cannot be written as a heading.`);
		else if (sent.has(key)) problems.push(`${name} is in the list twice.`);
		else if (known.has(key)) problems.push(`${name} is already in the glossary.`);
		else if (source && !allowed.has(source)) problems.push(`${name} names a note that is not under this glossary's folders.`);
		else {
			sent.add(key);
			entries.push({ term, category, definition, relevance, source, drafted: raw?.drafted === true });
		}
	}
	if (problems.length) return refuse(problems.join(' '));

	const next = withScannedTerms(note.content, entries, complete ? day : null);
	if (next === null) return refuse('These terms would not read back as written, so nothing was added.');
	if (next !== note.content) {
		const written = await vault.write(glossary.path, next, note.hash);
		if (!written.ok) return { ok: false, reason: 'conflict', message: 'The glossary changed while the terms were being added. Nothing was written; add them again.' };
	}
	return { ok: true, path: glossary.path, added: entries.length };
}

/**
 * `content` with `entries` appended and, when `scanned` is given, its
 * frontmatter's `scanned:` set to that day; or null when the result would not
 * read back as the entries already there, unchanged, plus exactly these.
 *
 * Each entry is appended through `appendEntry` with its category and, when
 * it has one, `source:: [[<note>]]` (the bare name when it would break a
 * link). An entry with a definition is looked up, its definition and `→`
 * line under it, with `drafted:: Claude` when the definition is Claude's; one
 * without is to look up. Every byte of `content` stays; `scanned:` is a span
 * edit of its own line. An entry whose term the text already has, that would
 * not read back as its own heading, or that has a `→` line but no
 * definition, makes the whole result null rather than touching another
 * entry. Pure.
 */
export function withScannedTerms(content: string, entries: ScannedEntry[], scanned: string | null): string | null {
	let text = content;
	for (const e of entries) {
		if (findEntry(text, e.term)) return null;
		const defined = e.definition.trim() !== '';
		if (!defined && e.relevance.trim()) return null;
		const appended = appendEntry(text, { term: e.term, status: defined ? 'looked-up' : 'to-look-up', category: e.category || null, source: e.source ? sourceLink(e.source) : null });
		const heading = findEntry(appended, e.term);
		if (!heading) return null;
		if (!defined) {
			text = appended;
			continue;
		}
		const drafted = e.drafted ? setField(appended, heading.term, 'drafted', 'Claude') : appended;
		const withBody = drafted && insertDefinition(drafted, heading.term, e.definition, e.relevance);
		if (!withBody) return null;
		text = withBody;
	}
	if (!text.startsWith(content)) return null;
	if (scanned) text = setFrontmatterField(text, 'scanned', scanned);
	return readsBack(content, text, entries, scanned) ? text : null;
}

/** Whether `after` is `before` plus exactly `added`, with `scanned` set when given. */
function readsBack(before: string, after: string, added: ScannedEntry[], scanned: string | null): boolean {
	const old = parseGlossary(before);
	const now = parseGlossary(after);
	if (now.length !== old.length + added.length) return false;
	const fields = (e: GlossaryEntry) => JSON.stringify(Object.entries(e.fields).map(([k, f]) => [k, f.value]));
	const unchanged = old.every((e, i) => e.term === now[i].term && e.definition === now[i].definition && e.relevance === now[i].relevance && fields(e) === fields(now[i]));
	const fresh = added.every((want, j) => {
		const got = now[old.length + j];
		const defined = want.definition.trim() !== '';
		return (
			normaliseTerm(got.term) === normaliseTerm(want.term) &&
			got.status === (defined ? 'looked-up' : 'to-look-up') &&
			got.category === (oneLine(want.category) || null) &&
			got.source === (want.source ? sourceLink(want.source) : null) &&
			(got.fields.drafted?.value ?? null) === (defined && want.drafted ? 'Claude' : null) &&
			(got.definition !== '') === defined &&
			(got.relevance ?? '') === oneLine(want.relevance)
		);
	});
	const was = scanSettings(before);
	const is = scanSettings(after);
	return unchanged && fresh && JSON.stringify(is.sources) === JSON.stringify(was.sources) && is.scanned === (scanned ?? was.scanned);
}

/** Whether `term`, written as an entry's heading, reads back as that term. */
function readsAsHeading(term: string): boolean {
	const entry = parseGlossary(appendEntry('', { term }))[0];
	return Boolean(entry) && normaliseTerm(entry.term) === normaliseTerm(term);
}

/** `[[<note>]]` for a note's path, or the bare name when it holds what would end a wikilink early. */
function sourceLink(path: string): string {
	const name = oneLine(basename(path));
	return /[[\]|#^]/.test(name) ? name : `[[${name}]]`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function cleanFolder(folder: string): string {
	return folder.trim().replace(/^\/+|\/+$/g, '').trim();
}

/**
 * What is not a note to scan: the hub's own files, the glossaries, and any
 * `Flashcards/` folder. Card files are made from glossaries and Anki decks,
 * so reading them for terms would feed a glossary its own cards back.
 */
function notScanned(path: string): boolean {
	return path.startsWith(`${config.hubFolder}/`) || path.startsWith(`${GLOSSARY_FOLDER}/`) || /(^|\/)Flashcards\//.test(path);
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
 * at it keep their `glossary:` line. Refuses a glossary that is not there.
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
interface TermEdit {
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

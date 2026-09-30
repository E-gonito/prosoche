/**
 * Flashcards made from a glossary, kept in step with it.
 *
 * A glossary turns its cards on once, `flashcards: true` in its frontmatter,
 * and from then on every term with a definition is one card, reviewed both
 * ways: the term, a `??` line, then the definition and the `→` line. The
 * cards are the glossary's deck (see `decks.ts`), one file per category:
 *
 *     Flashcards/<Glossary name>/<Category> (cards).md
 *
 * (`Uncategorised (cards).md` for a term with none). The suffix keeps a card
 * file from sharing its name with a note: the vault has notes called
 * Networking and Git too, and a bare `[[Networking]]` could open either. A
 * new file starts:
 *
 *     ---
 *     glossary: Computer Science
 *     category: Cloud
 *     ---
 *
 *     #flashcards
 *
 *     Made from [[Glossaries/Computer Science|Computer Science]] (Cloud). Edit the terms there; this file is
 *     kept in step with the glossary.
 *
 *     VPC
 *     ??
 *     An isolated virtual network…
 *     → Where eye2gene's endpoints live.
 *     <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!new-->
 *
 * `Flashcards/` also holds the `.txt` decks another tool generates; only
 * `.md` files are read or written here, so those are never touched. Cards
 * used to live in a study subject, under
 * `<subject home>/Flashcards/Glossary/<Glossary name>/<Category>.md`; a sync
 * first moves any files still there into the deck's folder, suffixed on the
 * way, review history and all.
 *
 * These files are prosoche's, as a workspace's `Board.md` is: their cards
 * follow the glossary. What the author or a review adds is theirs and is
 * kept: any frontmatter, every review comment (prosoche's
 * `<!--fsrs:…-->` or the plugin's legacy `<!--SR:…-->`), a card for a term
 * since deleted or renamed, and any card that matches no term.
 *
 * `reconcileGlossaryCards` is the whole policy, and it is pure: the entries
 * and the files as they are in, the new text of each file that changes out.
 * A card is matched to its term by `normaliseTerm` of its front. Its lines
 * are replaced in place when its text changed, keeping the comment below
 * them; it is cut, comment and all, from one file and appended to another
 * when its term changed category; and a term with no card gets one at the
 * end of its category's file. Every card goes through `cardBlock`'s
 * escaping, and every file must read back through `scanCards` as exactly the
 * cards expected, or it is left as it is and the problem reported.
 *
 * The rest of this module is when that runs and how it writes: after each
 * write the app makes to a glossary with cards, on any change to one from
 * outside (debounced), and for every such glossary at hub start, one
 * glossary at a time. Writes are guarded by the hash each file was read
 * with, and happen only when something differs. It never writes the
 * glossary, never writes outside the glossary's own folder of cards, and
 * never runs a model.
 */

import { config } from '../config';
import { setFrontmatterField } from '../parse/frontmatter';
import { parseNote } from '../parse/note';
import { parseGlossary } from '../parse/glossary';
import { normaliseTerm } from '$lib/shared/glossary';
import { cardBlock } from './card-block';
import { FLASHCARD_TAG, scanCards, type Card } from './cards';
import { cardSettings, GLOSSARY_FOLDER, glossaries, isGlossaryPath } from '../glossary';
import { hashContent, type Vault } from '../vault/index';

/** Where the old study subjects kept a glossary's cards, under their home folder. */
const LEGACY_FOLDER = /^(.+\/Flashcards\/Glossary\/[^/]+)\/[^/]+\.md$/;

/** The category of the terms with none, as its card file names it. */
const UNCATEGORISED = 'Uncategorised';

/** What every card file's name ends with, before `.md`. */
const SUFFIX = ' (cards)';

/**
 * Where the cards of the glossary called `glossary` go:
 * `Flashcards/<glossary>`, so two glossaries never share a file. Pure.
 */
export function deckFolder(glossary: string): string {
	return `${config.flashcardFolder}/${glossary}`;
}

/**
 * The card file name, without `.md`, for a category: anything a file name
 * or a wikilink cannot hold becomes a space, no category (or one with
 * nothing left) is `Uncategorised`, and ` (cards)` follows. Pure.
 */
export function categoryFileName(category: string | null): string {
	const name = (category ?? '')
		.replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[.\s]+|[.\s]+$/g, '');
	return `${name || UNCATEGORISED}${SUFFIX}`;
}

/**
 * The category a card file at `path` holds, as its name says:
 * `Flashcards/CS/Cloud (cards).md` is `Cloud`. A name without the suffix is
 * read whole. Pure.
 */
export function categoryOfFile(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
	return name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name;
}

/** The parts of a glossary entry a card is made of. */
export interface TermEntry {
	term: string;
	category: string | null;
	definition: string;
	relevance: string | null;
}

/** One file in a glossary's card folder, as read. */
export interface CardFileText {
	path: string;
	content: string;
}

/** One file whose text changes. */
interface CardFileChange {
	path: string;
	/** The file as read, or null for one to create. */
	before: string | null;
	/**
	 * `before` with its cards edited and new ones added but none taken out:
	 * written first, so a card moving between files is never in neither.
	 * The same as `after` when the file loses no card.
	 */
	staged: string;
	after: string;
}

/** What keeping a glossary's cards in step would change. */
interface Reconciliation {
	/** Only files that differ, by path. */
	changes: CardFileChange[];
	/** Terms that have a card: those with a definition that could be written. */
	cards: number;
	/** Terms that could not be made cards and files left as they were, one line each. */
	problems: string[];
}

/**
 * The card files of glossary `glossary`, in `folder`, brought in step with
 * its `entries`, given the files there now. Pure.
 *
 * - A term with no definition has no card yet; one whose sides `cardBlock`
 *   cannot write is reported. A term repeated in the glossary counts once.
 * - A card belongs to the term whose `normaliseTerm` its front has (after
 *   the same escaping). Cloze cards are never matched. When a term has
 *   several cards, the one in its category's file is its card, or else the
 *   first by path and line.
 * - A card whose text differs has its lines replaced in place; the review
 *   comment below them stays.
 * - A card in another file than its category's is cut from there, with its
 *   comment and one blank line, and appended to its category's file with
 *   the comment under it. A second copy of a card outside its category's
 *   file with the same comment (or none, like it) is what an interrupted
 *   move leaves, and is removed.
 * - A term with no card gets one at the end of its category's file, which
 *   is created with `cardFileHeader` when it is not there. A category's file
 *   is matched ignoring case.
 * - Nothing else in any file changes: frontmatter, the text above the
 *   cards, cards of deleted or renamed terms, cards that match no term.
 *
 * Each file's `staged` and `after` text must read back through `scanCards`
 * as the cards it had, edited, less those cut, plus those appended, in that
 * order, with their comments. A file that would not is left as it is, with
 * every term whose card would be written to or moved from it, and reported.
 * Running this again on its own output changes nothing.
 */
export function reconcileGlossaryCards(glossary: string, folder: string, entries: TermEntry[], files: CardFileText[]): Reconciliation {
	const problems: string[] = [];
	const wanted = wantedCards(entries, problems);
	const skip = new Set<string>();
	// Each pass either succeeds or leaves at least one more file alone, so
	// this ends after at most one pass per file.
	for (;;) {
		const result = plan(glossary, folder, wanted, files, skip);
		if (result.failed.length === 0) return { changes: result.changes, cards: wanted.length, problems: [...problems, ...[...skip].map(leftAlone)] };
		for (const path of result.failed) skip.add(path);
	}
}

/**
 * The link a card file's "Made from" line makes to its glossary: by path,
 * `[[Glossaries/Computer Science|Computer Science]]`, because a glossary
 * often shares its name with a note (the vault has both
 * `Glossaries/Computer Science.md` and `Computer Science/Computer
 * Science.md`), and a bare `[[Computer Science]]` could open either. Pure.
 */
function glossaryLink(glossary: string): string {
	return `[[${GLOSSARY_FOLDER}/${glossary}|${glossary}]]`;
}

/**
 * The opening of a new card file: `glossary:` and `category:` (empty for
 * none) in its frontmatter, the `#flashcards` tag, and a line saying where
 * the cards come from. It holds no card. Pure.
 */
export function cardFileHeader(glossary: string, category: string | null): string {
	const link = /[[\]|#^]/.test(glossary) ? glossary : glossaryLink(glossary);
	const intro = `Made from ${link}${category ? ` (${category})` : ''}. Edit the terms there; this file is\nkept in step with the glossary.`;
	const blank = `---\nglossary:\ncategory:\n---\n\n#${FLASHCARD_TAG}\n\n${intro}\n`;
	const named = setFrontmatterField(blank, 'glossary', glossary);
	return category ? setFrontmatterField(named, 'category', category) : named;
}

/** A term's card as it should read. */
interface Wanted {
	key: string;
	front: string;
	back: string;
	markdown: string;
	category: string | null;
}

function wantedCards(entries: TermEntry[], problems: string[]): Wanted[] {
	const seen = new Set<string>();
	const out: Wanted[] = [];
	for (const entry of entries) {
		const definition = entry.definition.trim();
		if (!definition) continue;
		const why = (entry.relevance ?? '').replace(/\s+/g, ' ').trim();
		const block = cardBlock(entry.term, why ? `${definition}\n→ ${why}` : definition);
		if (!block) {
			problems.push(`“${entry.term}” could not be written as a card.`);
			continue;
		}
		const key = normaliseTerm(block.card.front);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ key, front: block.card.front, back: block.card.back, markdown: block.markdown, category: entry.category?.trim() || null });
	}
	return out;
}

/** A card to append: its paragraph, the review comment it brings, and how it reads back. */
interface Appended {
	markdown: string;
	comment: string | null;
	front: string;
	back: string;
}

/** Everything to do to one file. */
interface FileEdits {
	/** By the card's first line: the card and what replaces its text. */
	replace: Map<number, { card: Card; wanted: Wanted }>;
	remove: Card[];
	append: Appended[];
	/** For a file to create: the category its header names. */
	category: string | null;
}

/** One card's identity as `scanCards` reads it, for comparing a file with what it should hold. */
type ReadBack = [kind: string, question: string, answer: string, comment: string | null];

function plan(glossary: string, folder: string, wanted: Wanted[], files: CardFileText[], skip: Set<string>): { changes: CardFileChange[]; failed: string[] } {
	const existing = [...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => ({ ...f, cards: scanCards(f.content, f.path) }));
	const byLower = new Map(existing.map((f) => [f.path.toLowerCase(), f.path]));
	const targetOf = (w: Wanted) => {
		const path = `${folder}/${categoryFileName(w.category)}.md`;
		if (!byLower.has(path.toLowerCase())) byLower.set(path.toLowerCase(), path);
		return byLower.get(path.toLowerCase())!;
	};

	const copies = new Map<string, Card[]>();
	for (const file of existing) {
		for (const card of file.cards) {
			if (card.kind === 'cloze') continue;
			const key = normaliseTerm(card.question);
			copies.set(key, [...(copies.get(key) ?? []), card]);
		}
	}

	const edits = new Map<string, FileEdits>();
	const edit = (path: string, category: string | null = null) => {
		if (!edits.has(path)) edits.set(path, { replace: new Map(), remove: [], append: [], category });
		return edits.get(path)!;
	};

	for (const w of wanted) {
		const target = targetOf(w);
		const found = copies.get(w.key) ?? [];
		const card = found.find((c) => c.path === target) ?? found[0];
		if (skip.has(target) || (card && skip.has(card.path))) continue;
		const append = (comment: string | null) => edit(target, w.category).append.push({ markdown: w.markdown, comment, front: w.front, back: w.back });

		if (!card) {
			append(null);
		} else if (card.path === target) {
			const same = card.kind === 'multiline-reversed' && card.question === w.front && card.answer === w.back;
			if (!same) edit(target).replace.set(card.line, { card, wanted: w });
			for (const other of found) {
				if (other !== card && other.path !== target && !skip.has(other.path) && commentOf(other) === commentOf(card)) edit(other.path).remove.push(other);
			}
		} else {
			append(commentOf(card));
			edit(card.path).remove.push(card);
		}
	}

	const changes: CardFileChange[] = [];
	const failed: string[] = [];
	for (const [path, e] of [...edits].sort(([a], [b]) => a.localeCompare(b))) {
		const file = existing.find((f) => f.path === path);
		const before = file ? file.content : null;
		const base = before ?? cardFileHeader(glossary, e.category);
		const oldCards = file ? file.cards : scanCards(base, path);
		const staged = applyEdits(base, e, false);
		const after = applyEdits(base, e, true);
		const ok = sameCards(scanCards(staged, path), expected(oldCards, e, false)) && sameCards(scanCards(after, path), expected(oldCards, e, true));
		if (!ok) failed.push(path);
		else if (after !== before) changes.push({ path, before, staged, after });
	}
	return { changes, failed };
}

/** A card's review comment as written, trimmed, or null when it has none. */
function commentOf(card: Card): string | null {
	return card.scheduleExists ? card.expectedRaw.trim() : null;
}

/**
 * `content` with the edits made: cards' text replaced line for line (a line
 * ending in `\r` keeps it), cards cut when `removals` says so, with one of
 * the blank lines that set them apart, and new cards appended, each its own
 * paragraph. Every other byte stays.
 */
function applyEdits(content: string, e: FileEdits, removals: boolean): string {
	const lines = content.split('\n');
	const ops: Array<{ from: number; to: number; lines: string[] | null }> = [];
	for (const { card, wanted } of e.replace.values()) {
		const cr = lines[card.line].endsWith('\r') ? '\r' : '';
		ops.push({ from: card.line, to: card.endLine, lines: wanted.markdown.split('\n').map((l) => l + cr) });
	}
	if (removals) for (const card of e.remove) ops.push({ from: card.line, to: card.scheduleExists ? card.scheduleLine : card.endLine, lines: null });

	ops.sort((a, b) => b.from - a.from);
	for (const op of ops) {
		lines.splice(op.from, op.to - op.from + 1, ...(op.lines ?? []));
		if (op.lines === null && blank(lines[op.from]) && (op.from === 0 || blank(lines[op.from - 1]))) lines.splice(op.from, 1);
	}

	let text = lines.join('\n');
	for (const card of e.append) text = `${text}${gap(text)}${card.markdown}\n${card.comment ? `${card.comment}\n` : ''}`;
	return text;
}

/** The cards a file should read back as, in order. */
function expected(old: Card[], e: FileEdits, removals: boolean): ReadBack[] {
	const cut = new Set(removals ? e.remove : []);
	const kept = old
		.filter((c) => !cut.has(c))
		.map((c): ReadBack => {
			const r = e.replace.get(c.line);
			return r && r.card === c ? ['multiline-reversed', r.wanted.front, r.wanted.back, commentOf(c)] : [c.kind, c.question, c.answer, commentOf(c)];
		});
	return [...kept, ...e.append.map((a): ReadBack => ['multiline-reversed', a.front, a.back, a.comment])];
}

function sameCards(found: Card[], want: ReadBack[]): boolean {
	return JSON.stringify(found.map((c): ReadBack => [c.kind, c.question, c.answer, commentOf(c)])) === JSON.stringify(want);
}

function blank(line: string | undefined): boolean {
	return line !== undefined && line.trim() === '';
}

/** What goes between `text` and a new paragraph so there is one blank line. */
function gap(text: string): string {
	if (text === '' || text.endsWith('\n\n')) return '';
	return text.endsWith('\n') ? '\n' : '\n\n';
}

function leftAlone(path: string): string {
	return `${path} would not read back as the glossary’s cards, so it was left as it is.`;
}

/**
 * Where a glossary's cards stand.
 *
 * `off`: its frontmatter does not turn them on (see `cardSettings`); any
 * cards already made stay where they are. `on`: its deck's folder, how many
 * cards the folder holds, the files that differ from the glossary (0 is up
 * to date), and any problem.
 */
type CardState = { state: 'off' } | { state: 'on'; folder: string; cards: number; pending: number; problems: string[] };

/** What one sync did. `written` lists the files changed, `conflict` the one that changed underneath it. */
type CardSync = CardState & { written?: string[]; conflict?: string | null };

/**
 * Where the cards of the glossary at `path` stand, without writing: whether
 * they are on, the cards in its folder now, and how many files a sync would
 * change. Reads the glossary and its card folder. Never writes.
 */
export async function glossaryCardsState(vault: Vault, path: string): Promise<CardState> {
	const found = await examine(vault, path);
	if (found.state !== 'found') return found;
	const { folder, files, plan } = found;
	const cards = files.reduce((sum, f) => sum + scanCards(f.content, f.path).length, 0);
	return { state: 'on', folder, cards, pending: plan.changes.length, problems: plan.problems };
}

/**
 * Bring the cards of the glossary at `path` in step with it, and log what
 * happened.
 *
 * Reads the glossary; when its cards are on, first moves in any of its card
 * files an old study subject still holds, and after a rename (`renamedFrom`,
 * the old name) the old name's deck folder (see `moveCardFiles`); then reads
 * the files in its deck folder, reconciles, and writes each file that
 * differs: first every file's `staged` text, then the final text of those
 * that lose a card, each write guarded by the hash of what it replaces (an
 * empty file for one being created). A clash stops the sync where it is,
 * with every card still in at least one file; the next change or the next
 * start tries again.
 *
 * Runs one at a time per vault: a call made while another is running waits
 * for it. Never writes the glossary, or any file but its cards' old and new
 * places; never throws for a clash.
 */
export function syncGlossaryCards(vault: Vault, path: string, opts: { renamedFrom?: string } = {}): Promise<CardSync> {
	const run = async (): Promise<CardSync> => {
		if (!cardSettings((await vault.read(path)).content).on) return { state: 'off' };
		const name = glossaryName(path);
		if (opts.renamedFrom) await moveCardFiles(vault, deckFolder(opts.renamedFrom), deckFolder(name), opts.renamedFrom, name);
		for (const legacy of await legacyFolders(vault, name)) await moveCardFiles(vault, legacy, deckFolder(name), undefined, undefined, true);
		const found = await examine(vault, path);
		if (found.state !== 'found') return found;
		const { folder, files, plan } = found;
		const hashes = new Map(files.map((f) => [f.path, f.hash]));
		const written: string[] = [];
		let conflict: string | null = null;

		const put = async (change: CardFileChange, text: string) => {
			const result = await vault.write(change.path, text, hashes.get(change.path) ?? hashContent(''));
			if (!result.ok) return false;
			hashes.set(change.path, result.note.hash);
			if (!written.includes(change.path)) written.push(change.path);
			return true;
		};
		for (const change of plan.changes) {
			if (conflict) break;
			if (change.staged !== change.before && !(await put(change, change.staged))) conflict = change.path;
		}
		for (const change of plan.changes) {
			if (conflict) break;
			if (change.after !== change.staged && !(await put(change, change.after))) conflict = change.path;
		}

		const now = await Promise.all((await vault.files(folder, 'md')).map((file) => vault.read(`${folder}/${file}`)));
		const cards = now.reduce((sum, n) => sum + scanCards(n.content, n.path).length, 0);
		const result: CardSync = { state: 'on', folder, cards, pending: conflict ? plan.changes.length - written.length : 0, problems: plan.problems, written, conflict };
		report(path, result);
		return result;
	};
	const queue = queues.get(vault) ?? Promise.resolve();
	const next = queue.then(run, run);
	queues.set(
		vault,
		next.then(
			() => undefined,
			() => undefined
		)
	);
	return next;
}

/** Each vault's running sync, so syncs happen one at a time. */
const queues = new WeakMap<Vault, Promise<unknown>>();

/**
 * Sync every glossary whose cards are on, one after another, as the hub
 * does at start. Returns what each did, in glossary order.
 */
export async function syncAllGlossaryCards(vault: Vault): Promise<CardSync[]> {
	const out: CardSync[] = [];
	for (const g of await glossaries(vault, [])) out.push(await syncGlossaryCards(vault, g.path));
	return out;
}

/**
 * Keep glossaries' cards in step with changes from anywhere: an edit in
 * Obsidian, a git pull, or a write of the app's own.
 *
 * Subscribes to the vault. A change to a glossary file (not a removal) syncs
 * that glossary `delayMs` after the last change to it. Changes to card files
 * are not glossary changes, so a sync's own writes never set off another.
 * Returns the unsubscribe, which also drops any sync not yet started.
 */
export function followGlossaryCards(vault: Vault, delayMs = 1000): () => void {
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	const unsubscribe = vault.subscribe((change) => {
		if (change.kind === 'removed' || !isGlossaryPath(change.path)) return;
		clearTimeout(timers.get(change.path));
		timers.set(
			change.path,
			setTimeout(() => {
				timers.delete(change.path);
				syncGlossaryCards(vault, change.path).catch((e) => console.error(`[glossary cards] ${change.path}`, e));
			}, delayMs)
		);
	});
	return () => {
		unsubscribe();
		for (const t of timers.values()) clearTimeout(t);
		timers.clear();
	};
}

/**
 * A card file of a renamed glossary, naming the new name: its `glossary:`
 * when that named the old one, and the "Made from" line's link, written by
 * path (see `glossaryLink`) whether the old one was or was bare, as files
 * made before links went by path are. Everything else stays. Pure.
 */
export function renamedCardFile(content: string, from: string, to: string): string {
	const named = parseNote(content).frontmatter.glossary;
	let text = typeof named === 'string' && normaliseTerm(named) === normaliseTerm(from) ? setFrontmatterField(content, 'glossary', to) : content;
	for (const old of [`Made from ${glossaryLink(from)}`, `Made from [[${from}]]`]) {
		const at = text.indexOf(old);
		if (at !== -1 && (at === 0 || text[at - 1] === '\n')) {
			text = `${text.slice(0, at)}Made from ${glossaryLink(to)}${text.slice(at + old.length)}`;
			break;
		}
	}
	return text;
}

/**
 * Move the card files in `source` to `target`, so the cards keep their
 * review history; with `from` and `to`, a renamed glossary's old and new
 * names, each is rewritten by `renamedCardFile` on the way, and with
 * `suffix`, a name without ` (cards)` gains it. Each file is copied and the
 * old one removed only if it is unchanged; a file whose new place is taken
 * is left where it is. Only `.md` files move. Does nothing when the two are
 * the same folder.
 */
async function moveCardFiles(vault: Vault, source: string, target: string, from?: string, to?: string, suffix = false): Promise<void> {
	if (source === target) return;
	for (const name of await vault.files(source, 'md')) {
		const old = await vault.read(`${source}/${name}`);
		const text = from && to ? renamedCardFile(old.content, from, to) : old.content;
		const renamed = suffix && !name.endsWith(`${SUFFIX}.md`) ? `${name.slice(0, -'.md'.length)}${SUFFIX}.md` : name;
		const copied = await vault.write(`${target}/${renamed}`, text, hashContent(''));
		if (!copied.ok) {
			console.warn(`[glossary cards] left ${source}/${name} where it is: ${target}/${renamed} is already there`);
			continue;
		}
		const removed = await vault.remove(`${source}/${name}`, old.hash);
		if (!removed.ok) await vault.remove(`${target}/${renamed}`, copied.note.hash);
	}
}

/**
 * The folders where an old study subject still holds cards of the glossary
 * called `name`: `<home>/Flashcards/Glossary/<name>`, found by listing the
 * vault. Usually none. Never writes.
 */
async function legacyFolders(vault: Vault, name: string): Promise<string[]> {
	const found = new Set<string>();
	for (const path of await vault.list()) {
		const folder = LEGACY_FOLDER.exec(path)?.[1];
		if (folder && folder.endsWith(`/Flashcards/Glossary/${name}`)) found.add(folder);
	}
	return [...found];
}

/** The glossary's card settings, card files and reconciliation, read once. */
async function examine(
	vault: Vault,
	path: string
): Promise<{ state: 'off' } | { state: 'found'; folder: string; files: Array<CardFileText & { hash: string }>; plan: Reconciliation }> {
	const note = await vault.read(path);
	if (!note.exists || !cardSettings(note.content).on) return { state: 'off' };

	const name = glossaryName(path);
	const folder = deckFolder(name);
	const files = [];
	for (const file of await vault.files(folder, 'md')) {
		const read = await vault.read(`${folder}/${file}`);
		if (read.exists) files.push({ path: read.path, content: read.content, hash: read.hash });
	}
	const plan = reconcileGlossaryCards(name, folder, parseGlossary(note.content), files);
	return { state: 'found', folder, files, plan };
}

/** `Glossaries/<name>.md` → `<name>`. */
function glossaryName(path: string): string {
	return path.slice(GLOSSARY_FOLDER.length + 1, -'.md'.length);
}

function report(path: string, result: CardSync): void {
	if (result.state !== 'on') return;
	if (result.written?.length) console.log(`[glossary cards] ${path}: wrote ${result.written.join(', ')}`);
	if (result.conflict) console.warn(`[glossary cards] ${path}: ${result.conflict} changed while it was being written; trying again on the next change`);
	for (const problem of result.problems) console.warn(`[glossary cards] ${path}: ${problem}`);
}

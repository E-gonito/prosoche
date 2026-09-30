/**
 * Cards made from notes: which notes a subject offers to make them from,
 * which of its own card files they go to, and the one write that adds them.
 *
 * Cards made on the Make cards page never go into the note they came from.
 * They go into the subject's own `Flashcards/` folder, one file per goal,
 * `<home>/Flashcards/<Goal>.md`, or `From notes.md` for cards under no goal,
 * so the Flashcards tab groups them and a note stays the author's prose:
 *
 *     ---
 *     goal: Networking
 *     ---
 *
 *     #flashcards
 *
 *     ## [[TCP]]
 *
 *     What opens a TCP connection?::The three-way handshake
 *
 *     Which flags does it send?
 *     ?
 *     SYN, then SYN-ACK, then ACK
 *
 * Each source note has a `## [[<note>]]` heading, reused when it is already
 * there, and each card is its own paragraph so a multiline card can never
 * swallow the next. A new file is laid out as the Anki import lays one out.
 * An existing one only ever gains lines: new cards go at the end of their
 * note's section through `appendUnderHeading`, or at the end of the file
 * under a new heading, and no byte already there moves or changes.
 *
 * `addCards` is the accept step for a language model's drafts, so it trusts
 * nothing it is sent. The file is chosen here, from the subject and a goal
 * that must be in `Goals.md`; each card's source must be a note the subject
 * offers; each side goes through the Anki import's escaping (`cardBlock`);
 * and the whole new file is read back through `scanCards`, which must find
 * the cards that were there and exactly the new ones besides, before one
 * byte is written.
 */

import { basename, parseNote } from '../parse/note';
import { setFrontmatterField } from '../parse/frontmatter';
import { appendUnderHeading } from '../sections';
import { cardBlock } from './anki-import';
import { FLASHCARD_TAG, isCardSource, scanCards } from './flashcards';
import { findGoal, goalRefs, readGoals } from './goals';
import { scopedNotes } from './scope';
import type { Subject } from './subjects';
import type { CardsAdded, NewCard, SourceNote } from '$lib/shared/study';
import type { Vault } from '../vault/index';

/** The card file for cards under no goal, without `.md`. */
const FROM_NOTES = 'From notes';

/** Cards one add may carry. More is a second press. */
const MAX_NEW_CARDS = 60;

/** The longest side a card may have, in characters. */
const MAX_SIDE = 4000;

/**
 * The card file cards under `goal` go to: `<home>/Flashcards/<goal>.md`, or
 * `<home>/Flashcards/From notes.md` for none. A goal's name is made a file
 * name by turning anything a file name or a wikilink cannot hold into a
 * space. Pure. Always inside the subject's `Flashcards/` folder.
 */
export function cardFilePath(subject: Pick<Subject, 'files'>, goal: string | null): string {
	const name = goal ? goal.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '') : '';
	return `${subject.files.flashcards}/${name || FROM_NOTES}.md`;
}

/**
 * A question reduced to lowercase words, so two cards asking the same thing
 * with different punctuation or spacing are one question. Pure.
 */
export function questionKey(question: string): string {
	return question.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The notes a subject offers to make cards from, sorted by path, with the
 * folders to pick them by.
 *
 * A note is offered when it is in the subject's scope (its folders or its
 * tag) and is not one of the subject's own files: `Goals.md`, `Reading
 * List.md`, `Sessions.md` or anything under `Flashcards/`. Folders are those
 * inside the subject's own folders that hold an offered note, directly or
 * below. Reads the notes through the shared study sweep; never writes.
 */
export async function sourceNotes(vault: Vault, subject: Subject): Promise<{ notes: SourceNote[]; folders: string[] }> {
	const own = new Set([subject.files.goals, subject.files.reading, subject.files.sessions]);
	const notes = (await scopedNotes(vault, subject.scope))
		.filter((n) => !own.has(n.path) && !n.path.startsWith(`${subject.files.flashcards}/`))
		.map((n) => ({ path: n.path, title: n.parsed.title || basename(n.path), mtimeMs: n.mtimeMs }))
		.sort((a, b) => a.path.localeCompare(b.path));

	const roots = (subject.scope.folders ?? []).map((f) => f.replace(/\/+$/, '')).filter(Boolean);
	const folders = new Set<string>();
	for (const note of notes) {
		const parts = note.path.split('/').slice(0, -1);
		for (let i = parts.length; i > 0; i--) {
			const folder = parts.slice(0, i).join('/');
			if (!roots.some((r) => folder === r || folder.startsWith(`${r}/`))) break;
			folders.add(folder);
		}
	}
	return { notes, folders: [...folders].sort((a, b) => a.localeCompare(b)) };
}

/**
 * The notes a pick names, in reading order: the notes named, in the order
 * given, then every offered note under each folder named, by path, each
 * once. A note or folder the subject does not offer is ignored. Pure.
 */
export function pickedNotes(offered: SourceNote[], pick: { notes?: string[]; folders?: string[] }): string[] {
	const known = new Set(offered.map((n) => n.path));
	const out = new Set<string>();
	for (const path of pick.notes ?? []) if (known.has(path)) out.add(path);
	for (const raw of pick.folders ?? []) {
		const folder = raw.replace(/^\/+|\/+$/g, '');
		if (!folder) continue;
		for (const note of offered) if (note.path.startsWith(`${folder}/`)) out.add(note.path);
	}
	return [...out];
}

/** One card ready to file: both sides as they will read back, its paragraph, and its note's name. */
export interface FiledCard {
	front: string;
	back: string;
	markdown: string;
	/** The source note's name, for its `## [[<name>]]` heading. */
	note: string;
}

/**
 * `content` with `cards` added, or null when the result would not read back
 * as the cards already there plus exactly these.
 *
 * An empty `content` starts a card file: `goal:` in its frontmatter (empty
 * for none), a `#flashcards` line, then the cards. Otherwise every byte of
 * `content` is kept and cards are only inserted: each under the `## [[<note>]]`
 * heading of the note it came from, at the end of that section, or under a
 * new such heading at the end of the file. A file that is not yet a card
 * source (no `#flashcards` tag and no review comment) gains a `#flashcards`
 * line at the end, or neither Obsidian nor Study would review the cards.
 *
 * A card whose question the file already asks, or that an earlier card in
 * `cards` asked, is skipped and counted. Pure.
 */
export function withNewCards(
	content: string,
	path: string,
	goal: string | null,
	cards: FiledCard[]
): { content: string; added: FiledCard[]; skipped: number } | null {
	const before = scanCards(content, path);
	const asked = new Set(before.map((c) => questionKey(c.question)));
	const added: FiledCard[] = [];
	let skipped = 0;

	const byNote = new Map<string, FiledCard[]>();
	for (const card of cards) {
		const key = questionKey(card.front);
		if (asked.has(key)) {
			skipped++;
			continue;
		}
		asked.add(key);
		added.push(card);
		byNote.set(card.note, [...(byNote.get(card.note) ?? []), card]);
	}
	if (added.length === 0) return { content, added, skipped };

	let text = content.trim() === '' ? newCardFile(goal) : content;
	const tagged = content.trim() === '' || isCardSource(parseNote(content, path).tags, content);
	for (const [note, group] of byNote) {
		const heading = `## ${noteHeading(note)}`;
		const blocks = group.map((c) => c.markdown).join('\n\n');
		text = hasHeading(text, heading) ? appendUnderHeading(text, heading, `\n${blocks}`).content : `${text}${gap(text)}${heading}\n\n${blocks}\n`;
	}
	if (!tagged) text = `${text}${gap(text)}#${FLASHCARD_TAG}\n`;

	return readsBack(before, scanCards(text, path), added) ? { content: text, added, skipped } : null;
}

type CardsAddResult =
	| ({ ok: true } & CardsAdded)
	| { ok: false; reason: 'invalid'; problems: string[] }
	| { ok: false; reason: 'conflict'; problems: string[] };

/**
 * Add the cards a person ticked and edited on the Make cards page to the
 * subject's card file for `goal` (see `cardFilePath`).
 *
 * The explicit accept step for drafted cards, so everything is checked again
 * here, whatever the page sent: `goal` must be null or a goal in the
 * subject's `Goals.md` (by name, ignoring case and punctuation; the file is
 * named for the goal as written there); there must be between 1 and
 * `MAX_NEW_CARDS` cards; each side must be text of at most `MAX_SIDE`
 * characters that `cardBlock` can make into a card; and each source must be
 * a note `sourceNotes` offers. Any failure refuses the lot, with one problem
 * per card, and writes nothing. Then `withNewCards` must read back.
 *
 * Side effects: one write, to that one card file, guarded by the hash it
 * read, so an edit made meanwhile comes back as a conflict. A card whose
 * question the file already asks is skipped, and when every card is, nothing
 * is written. Never writes a note the cards came from, never writes outside
 * the subject's `Flashcards/` folder, and never changes a byte already in
 * the card file.
 */
export async function addCards(vault: Vault, subject: Subject, input: { goal: unknown; cards: unknown }): Promise<CardsAddResult> {
	const invalid = (...problems: string[]) => ({ ok: false as const, reason: 'invalid' as const, problems });

	const goals = goalRefs(await readGoals(vault, subject.files.goals));
	const wanted = typeof input.goal === 'string' && input.goal.trim() ? input.goal.trim() : null;
	const goal = wanted ? findGoal(goals, wanted) : null;
	if (wanted && !goal) return invalid(`There is no goal called "${wanted}" in ${subject.name}'s Goals.md.`);

	const path = cardFilePath(subject, goal?.name ?? null);
	if (!path.startsWith(`${subject.files.flashcards}/`) || path.split('/').includes('..')) return invalid('That card file is not in the Flashcards folder.');

	if (!Array.isArray(input.cards) || input.cards.length === 0) return invalid('There are no cards to add.');
	if (input.cards.length > MAX_NEW_CARDS) return invalid(`At most ${MAX_NEW_CARDS} cards can be added at once.`);

	const offered = new Set((await sourceNotes(vault, subject)).notes.map((n) => n.path));
	const problems: string[] = [];
	const filed: FiledCard[] = [];
	for (const [i, raw] of (input.cards as Array<Partial<NewCard> | null>).entries()) {
		const n = `Card ${i + 1}`;
		const { question, answer, source } = raw ?? {};
		if (typeof question !== 'string' || typeof answer !== 'string' || typeof source !== 'string') {
			problems.push(`${n} is not a card.`);
		} else if (question.length > MAX_SIDE || answer.length > MAX_SIDE) {
			problems.push(`${n} is too long.`);
		} else if (!offered.has(source)) {
			problems.push(`${n} names a note that is not one of ${subject.name}'s.`);
		} else {
			const block = cardBlock(question, answer);
			if (block) filed.push({ front: block.card.front, back: block.card.back, markdown: block.markdown, note: basename(source) });
			else problems.push(`${n} needs both a question and an answer.`);
		}
	}
	if (problems.length) return invalid(...problems);

	const note = await vault.read(path);
	const next = withNewCards(note.content, path, goal?.name ?? null, filed);
	if (!next) return invalid('These cards would not read back as written, so nothing was added.');
	if (next.added.length) {
		const written = await vault.write(path, next.content, note.hash);
		if (!written.ok) return { ok: false, reason: 'conflict', problems: [`${path} changed while the cards were being added. Nothing was written; add them again.`] };
	}
	return { ok: true, path, added: next.added.length, skipped: next.skipped, goal };
}

/** A new card file's opening: `goal:` frontmatter and the tag line. */
function newCardFile(goal: string | null): string {
	const blank = `---\ngoal:\n---\n\n#${FLASHCARD_TAG}\n`;
	return goal ? setFrontmatterField(blank, 'goal', goal) : blank;
}

/**
 * `[[<note>]]`, or the bare name when it holds something that would end a
 * wikilink early; such a name cannot be linked to by name anyway.
 */
function noteHeading(note: string): string {
	const name = note.replace(/\s+/g, ' ').trim();
	return /[[\]|#^]/.test(name) ? name : `[[${name}]]`;
}

/** What goes between `text` and a new paragraph so there is one blank line. */
function gap(text: string): string {
	if (text === '' || text.endsWith('\n\n')) return '';
	return text.endsWith('\n') ? '\n' : '\n\n';
}

const FENCE = /^[ \t]*(```|~~~)/;

/** Whether `text` has `heading` outside code, matched as `appendUnderHeading` matches it. */
function hasHeading(text: string, heading: string): boolean {
	const wanted = heading.trim().toLowerCase();
	let fence: string | null = null;
	for (const line of text.split('\n')) {
		const f = FENCE.exec(line);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence === null && line.trim().toLowerCase() === wanted) return true;
	}
	return false;
}

/**
 * Whether `after` is `before` plus exactly the cards `added`: each added card
 * found once with its sides as filed, and what is left, in order, the cards
 * that were there.
 */
function readsBack(before: Array<{ question: string; answer: string }>, after: Array<{ question: string; answer: string }>, added: FiledCard[]): boolean {
	const rest = [...after];
	for (const card of added) {
		const at = rest.findIndex((c) => c.question === card.front && c.answer === card.back);
		if (at === -1) return false;
		rest.splice(at, 1);
	}
	return rest.length === before.length && rest.every((c, i) => c.question === before[i].question && c.answer === before[i].answer);
}

/**
 * Flashcards: finding them in the vault's markdown, and writing reviews back.
 *
 * Cards are not stored anywhere. They are regions of the user's notes, written
 * in Obsidian Spaced Repetition's card syntax, and their review state is one
 * comment of prosoche's own on the line after the card, holding the FSRS
 * state of each card side (see `shared/scheduler.ts`):
 *
 *     <!--fsrs:2026-10-02,3.21,5.8,4,0,review,2026-09-29!new-->
 *
 * that is `due,stability,difficulty,reps,lapses,state,last review` per side,
 * `!` between sides, and `new` for a side never answered. This module is the
 * only place that knows that syntax, and it is the only place that writes
 * it. Nothing about a card lives in SQLite, so deleting the index changes
 * nothing.
 *
 * The plugin's own `<!--SR:!date,interval,ease-->` comment is still read, as
 * FSRS state seeded from SM-2, and is rewritten in the new form only when
 * that card is next graded. The plugin no longer maintains these cards: a
 * card graded here is one it cannot read.
 *
 * Three things were checked against the real vault before this was written,
 * because two of them contradicted the specification:
 *
 *  - Not one note carries `#flashcards`, yet three notes carry SR comments. A
 *    note therefore counts as a card source if it has a flashcard tag *or* it
 *    already has a schedule comment. Notes holding cards that Obsidian cannot
 *    see are counted and reported rather than quietly harvested, so the fix —
 *    adding the tag — stays the user's to make.
 *  - `::` and `==` appear all over this vault as Rust paths and C comparisons.
 *    Code fences and inline code spans are masked before anything is matched,
 *    and a cloze must have no space just inside its delimiters, or
 *    `total == 0` becomes a flashcard.
 *  - The plugin finds an inline card's comment only when it starts at column
 *    zero on the next line, so that is where a new comment goes.
 *
 * A card file belongs to a goal through its frontmatter, `goal: <name>`, so
 * every card in it counts towards that goal; setting it is the one other
 * write this module makes, one frontmatter line.
 */

import { basename, parseNote } from '../parse/note';
import { setFrontmatterField } from '../parse/frontmatter';
import { goalOf } from './goals';
import { inScope, scopedNotes } from './scope';
import { recordIntroduced } from './new-cards';
import type { Subject } from './subjects';
import { fromSm2, outcomes, type CardState, type Grade, type Schedule } from '$lib/shared/scheduler';
import { slugify } from '$lib/shared/slug';
import type { Card, CardFile, CardKind, CardQueue, StudyScope } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';

export type { Card, CardKind, CardQueue, StudyScope };

/** Separators, as configured in this vault's plugin settings. */
const SEPARATORS: Array<{ text: string; kind: CardKind }> = [
	{ text: ':::', kind: 'inline-reversed' },
	{ text: '::', kind: 'inline' }
];
const MULTILINE: Record<string, CardKind> = { '?': 'multiline', '??': 'multiline-reversed' };

const OPEN = '<!--fsrs:';
/** The Obsidian plugin's comment, read but never written. */
const SR_OPEN = '<!--SR:';
const CLOSE = '-->';
/** The plugin's stand-in due date for a sibling card that is still new. */
const NEW_CARD_DATE = '2000-01-01';
/** How the comment marks a card side never answered. */
const NEW = 'new';
const STATES: readonly CardState[] = ['learning', 'review', 'relearning'];

/** The tag the plugin harvests from, matching `flashcardTags` in its settings. */
export const FLASHCARD_TAG = 'flashcards';

/**
 * A cloze, requiring non-space immediately inside the delimiters. Without that
 * guard `(count == 0 && total == 0)` is one giant cloze, as
 * this vault's HTTP note proved.
 */
const CLOZE = /==(?=\S)([^=\n]*[^=\s])==/g;

const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;

/**
 * Every card in one note, in file order.
 *
 * Pure: `content` and `path` in, cards out, no filesystem and no clock. Line
 * numbers are absolute in the file, frontmatter included, so a caller can
 * rewrite exactly what it was shown.
 *
 * Precedence inside a paragraph, chosen to match the plugin's own parser: a
 * line that is nothing but `?` makes the whole paragraph one multiline card;
 * otherwise every line carrying `::` is its own card; otherwise a paragraph
 * containing `==cloze==` is one card per cloze, sharing one comment.
 *
 * A fenced block belongs to the paragraph it sits in, blank lines and all,
 * as it does in the plugin, so a multiline card can hold code. Its lines are
 * carried in the card's text but never matched: nothing inside a fence is a
 * separator, a `?` line or a cloze.
 *
 * Never returns a card whose question or answer is empty, and never finds a
 * card inside a fenced block or an inline code span.
 */
export function scanCards(content: string, path: string): Card[] {
	const lines = content.split('\n');
	const parsed = parseNote(content, path);
	const deck = deckOf(parsed.tags, path);
	const cards: Card[] = [];

	let fence: string | null = null;
	let trail: Array<{ level: number; text: string }> = [];
	let block: Line[] = [];

	const flush = () => {
		if (block.length) {
			for (const card of cardsInBlock(block, context(parsed.title, trail), deck)) cards.push({ ...card, path });
		}
		block = [];
	};

	for (let i = frontmatterEnd(lines); i < lines.length; i++) {
		const raw = lines[i];
		const f = FENCE.exec(raw);
		if (f || fence !== null) {
			if (fence === null) fence = f![1];
			else if (f?.[1] === fence) fence = null;
			block.push({ at: i, raw, masked: '', code: true });
			continue;
		}

		if (raw.trim() === '') {
			flush();
			continue;
		}
		const h = HEADING.exec(raw);
		if (h) {
			flush();
			trail = [...trail.filter((t) => t.level < h[1].length), { level: h[1].length, text: h[2] }];
			continue;
		}
		block.push({ at: i, raw, masked: maskCode(raw), code: false });
	}
	flush();
	return cards;
}

/**
 * One line of a paragraph. `masked` has inline code blanked out; a line of a
 * fenced block is marked `code` and has nothing left to match at all.
 */
interface Line {
	at: number;
	raw: string;
	masked: string;
	code: boolean;
}

/**
 * Whether a note's cards are ones Obsidian would also review.
 *
 * True when the note carries a flashcard tag, which is how the plugin decides,
 * or when it already holds a schedule comment, which proves cards there have
 * been reviewed. Everything else is a note that merely contains something
 * shaped like a card.
 */
export function isCardSource(tags: string[], content: string): boolean {
	const tagged = tags.some((t) => t === FLASHCARD_TAG || t.startsWith(`${FLASHCARD_TAG}/`));
	return tagged || content.includes(OPEN) || content.includes(SR_OPEN);
}

interface DueQuery {
	/** Folders and note tags that say what is in scope. Empty is the whole vault. */
	scope?: StudyScope;
	/** The day to schedule against, `YYYY-MM-DD`. */
	on: string;
	/** How many cards to return. The counts describe everything found. */
	limit?: number;
	/**
	 * Only cards from files whose `goal:` names this goal, compared as slugs,
	 * so case and punctuation do not matter. Absent means every card.
	 */
	goal?: string;
	/**
	 * How many cards never reviewed may join today, per part of the scope:
	 * each quota lets in the first `allowance` unseen cards in its scope, in
	 * the queue's stable order, and a card any quota lets in is ready. A
	 * study subject's quota is its new cards per day less those already
	 * begun today (see `new-cards.ts`). Absent means every unseen card is
	 * ready.
	 */
	newCards?: Array<{ scope: StudyScope; allowance: number }>;
}

/**
 * The goal a card file's frontmatter puts its cards under: `goal:` as a
 * name, or as a `[[Goals#…]]` link, which is read for its heading. A list
 * gives its first entry. Null when there is none. Pure.
 */
export function fileGoal(frontmatter: Record<string, unknown>): string | null {
	const raw = Array.isArray(frontmatter.goal) ? frontmatter.goal[0] : frontmatter.goal;
	if (typeof raw !== 'string' || !raw.trim()) return null;
	const link = /^\[\[([^[\]]+)\]\]$/.exec(raw.trim());
	return link ? (goalOf(link[1]) ?? link[1].trim()) : raw.trim();
}

/**
 * The cards to review, and what else is in scope.
 *
 * Ordered most overdue first, then cards never reviewed, then by position in
 * the vault. Deliberately deterministic where the plugin shuffles, so a review
 * session can be resumed and a test can name a card.
 *
 * A card never reviewed is ready only when a quota in `newCards` lets it in
 * today; the others are counted as `waiting`. The quotas are applied to the
 * whole scope before `goal` narrows it, so one goal's review offers the same
 * new cards the subject's does, and a file's `due` counts the same ones.
 *
 * Reads every markdown file in scope, because review state lives in the
 * markdown and the index holds no card table. That is a few hundred small
 * files for this vault, and it is the price of the state being in the notes.
 *
 * `files` lists every card source in scope, with its goal and counts,
 * whichever goal was asked for, so one call gives the Flashcards tab both its
 * list and its queue.
 *
 * Never writes. Never throws: a note that cannot be read contributes nothing.
 */
export async function dueCards(vault: Vault, index: NoteIndex, query: DueQuery): Promise<CardQueue> {
	const sources: Array<{ path: string; title: string; goal: string | null; tags: string[]; cards: Card[] }> = [];
	const invisible: CardQueue['invisible'] = [];
	const wanted = query.goal === undefined ? null : slugify(query.goal);

	for (const { path, content, parsed } of await scopedNotes(vault, query.scope)) {
		const found = scanCards(content, path);
		if (!found.length) continue;
		if (isCardSource(parsed.tags, content)) {
			sources.push({ path, title: index.noteTitle(path) ?? parsed.title, goal: fileGoal(parsed.frontmatter), tags: parsed.tags, cards: found });
		} else {
			// Only cards the user clearly wrote as cards. A `==highlight==` in an
			// untagged note is emphasis: this vault has a speech transcript with
			// twenty of them, and reporting those as missing flashcards would be
			// noise rather than a nudge.
			const explicit = found.filter((c) => c.kind !== 'cloze').length;
			if (explicit) invisible.push({ path, title: index.noteTitle(path) ?? parsed.title, cards: explicit });
		}
	}

	const released = releaseNew(sources, query.newCards);
	const isReady = (c: Card) => (c.schedule === null ? released === null || released.has(c) : c.schedule.due <= query.on);
	const files: CardFile[] = sources.map((s) => ({ path: s.path, title: s.title, goal: s.goal, cards: s.cards.length, due: s.cards.filter(isReady).length }));
	const cards = sources.filter((s) => wanted === null || (s.goal !== null && slugify(s.goal) === wanted)).flatMap((s) => s.cards);

	const ready = cards.filter(isReady);
	ready.sort(byUrgency);
	return {
		cards: ready.slice(0, query.limit ?? 200),
		due: ready.filter((c) => c.schedule !== null).length,
		fresh: ready.filter((c) => c.schedule === null).length,
		waiting: cards.filter((c) => c.schedule === null && !isReady(c)).length,
		total: cards.length,
		files: files.sort((a, b) => a.path.localeCompare(b.path)),
		invisible: invisible.sort((a, b) => b.cards - a.cards)
	};
}

/**
 * The unseen cards the quotas let in today: for each quota, the first
 * `allowance` cards never reviewed in its scope, in queue order (by path,
 * then line). Null when there are no quotas, meaning every one.
 */
function releaseNew(sources: Array<{ tags: string[]; cards: Card[] }>, quotas: DueQuery['newCards']): Set<Card> | null {
	if (!quotas) return null;
	const unseen = sources.flatMap((s) => s.cards.filter((c) => c.schedule === null).map((card) => ({ card, tags: s.tags })));
	unseen.sort((a, b) => byUrgency(a.card, b.card));
	const out = new Set<Card>();
	for (const quota of quotas) {
		let left = quota.allowance;
		for (const { card, tags } of unseen) {
			if (left <= 0) break;
			if (!inScope(card.path, tags, quota.scope)) continue;
			out.add(card);
			left--;
		}
	}
	return out;
}

type GoalSet = { ok: true } | { ok: false; reason: 'no-note' | 'not-cards' | 'conflict' };

/**
 * Put a card file's cards under `goal`, or under none for null, by setting
 * `goal:` in its frontmatter.
 *
 * One frontmatter line changes, through `setFrontmatterField`; the rest of
 * the note, cards and schedules included, is untouched, and a note with no
 * frontmatter gains a two-line block at the top. Refuses a note outside
 * `scope` or one that holds no cards Study reviews, so this can never become
 * a way to write to any note in the vault. Clearing leaves an empty `goal:`
 * key in place for the next time.
 */
export async function setCardFileGoal(vault: Vault, scope: StudyScope, path: string, goal: string | null): Promise<GoalSet> {
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'no-note' };
	const { tags } = parseNote(note.content, path);
	if (!inScope(path, tags, scope) || !isCardSource(tags, note.content) || !scanCards(note.content, path).length) {
		return { ok: false, reason: 'not-cards' };
	}
	const written = await vault.write(path, setFrontmatterField(note.content, 'goal', goal ?? ''), note.hash);
	return written.ok ? { ok: true } : { ok: false, reason: 'conflict' };
}

type Reviewed =
	| {
			ok: true;
			card: Card;
			/** Set when a comment was inserted, so a caller holding other cards
			 *  from the same note can move their line numbers on. */
			shift: { path: string; afterLine: number; by: number } | null;
	  }
	| { ok: false; reason: 'no-note' | 'changed'; current: string | null };

/**
 * Grade the card at `at` as the browser last saw it, and count a first review
 * against today's new cards of every subject in `subjects` holding it.
 *
 * The card, and its current schedule, are read back out of the note, so a
 * stale page cannot post a schedule of its own; `at.expectedRaw` is a
 * conflict token, not data. Writes as `review` does. Refuses with `no-note`,
 * `no-card` for a card no longer in the note, or `changed` with the line now
 * there.
 */
export async function gradeAt(
	vault: Vault,
	subjects: Subject[],
	at: { path: string; line: number; index: number; expectedRaw?: string },
	grade: Grade,
	day: string
): Promise<Reviewed | { ok: false; reason: 'no-card' }> {
	const note = await vault.read(at.path);
	if (!note.exists) return { ok: false, reason: 'no-note', current: null };
	const card = scanCards(note.content, at.path).find((c) => c.line === at.line && c.index === at.index);
	if (!card) return { ok: false, reason: 'no-card' };
	if (at.expectedRaw !== undefined && card.expectedRaw !== at.expectedRaw) return { ok: false, reason: 'changed', current: card.expectedRaw };
	const result = await review(vault, card, grade, day);
	if (result.ok && card.schedule === null) await recordIntroduced(vault, subjects, card.path, note.content, day);
	return result;
}

/**
 * Grade a card and write its new schedule into the note.
 *
 * One line changes: the card's comment is rewritten in place, or, when the
 * card has never been reviewed, one comment line is inserted directly after
 * the card. Every other byte of the note is left alone, and no note is ever
 * re-serialised from a parsed model.
 *
 * The comment is always written in prosoche's `<!--fsrs:…-->` form, holding
 * the sibling schedules of a cloze's other deletions too; a legacy
 * `<!--SR:…-->` comment is converted whole when one of its cards is graded.
 *
 * Refuses rather than guesses when the line it expected is no longer there, so
 * a card edited in Obsidian since the page loaded cannot be clobbered.
 */
export async function review(vault: Vault, card: Card, grade: Grade, today: string): Promise<Reviewed> {
	const note = await vault.read(card.path);
	if (!note.exists) return { ok: false, reason: 'no-note', current: null };

	const lines = note.content.split('\n');
	const at = lines[card.scheduleLine] ?? null;
	if (at !== card.expectedRaw) return { ok: false, reason: 'changed', current: at };

	const schedule = outcomes(card.schedule, today)[grade].schedule;
	const entries = card.scheduleExists ? parseEntries(card.expectedRaw) : [];
	const comment = formatComment(entries, card.index, card.siblings, schedule);

	let shift: { path: string; afterLine: number; by: number } | null = null;
	if (card.scheduleExists) {
		// Keep whatever indentation the comment already had: those bytes are the
		// user's, or the plugin's, and not ours to tidy.
		lines[card.scheduleLine] = `${/^[ \t]*/.exec(at)![0]}${comment}`;
	} else {
		// Column zero, where the plugin put its comments, so a note keeps one
		// shape whichever wrote it.
		lines.splice(card.scheduleLine + 1, 0, comment);
		shift = { path: card.path, afterLine: card.scheduleLine, by: 1 };
	}

	const written = await vault.write(card.path, lines.join('\n'), note.hash);
	if (!written.ok) return { ok: false, reason: 'changed', current: null };

	const scheduleLine = card.scheduleExists ? card.scheduleLine : card.scheduleLine + 1;
	return {
		ok: true,
		shift,
		card: { ...card, schedule, scheduleLine, scheduleExists: true, expectedRaw: lines[scheduleLine] }
	};
}

/** Most overdue first, then new cards, then wherever they sit in the vault. */
function byUrgency(a: Card, b: Card): number {
	const due = (c: Card) => c.schedule?.due ?? '9999-99-99';
	return due(a).localeCompare(due(b)) || a.path.localeCompare(b.path) || a.line - b.line || a.index - b.index;
}

/** The cards in one paragraph of non-blank lines. */
function cardsInBlock(
	block: Line[],
	context: string,
	deck: string
): Card[] {
	const body = block.filter((l) => l.code || !isSchedule(l.raw));
	if (!body.length) return [];

	const separator = body.findIndex((l) => !l.code && MULTILINE[l.raw.trim()] !== undefined);
	if (separator > 0) {
		const question = body.slice(0, separator);
		const answer = body.slice(separator + 1);
		if (!answer.length) return [];
		const kind = MULTILINE[body[separator].raw.trim()];
		return [
			build({
				kind,
				question: text(question),
				answer: text(answer),
				line: question[0].at,
				endLine: answer[answer.length - 1].at,
				schedules: 1,
				block,
				context,
				deck
			})
		];
	}

	const inline: Card[] = [];
	for (const line of body) {
		const found = SEPARATORS.find((s) => splitAt(line.masked, s.text) !== null);
		if (!found) continue;
		const cut = splitAt(line.masked, found.text)!;
		const question = line.raw.slice(0, cut).trim();
		const answer = line.raw.slice(cut + found.text.length).trim();
		if (!question || !answer) continue;
		inline.push(
			build({
				kind: found.kind,
				question,
				answer,
				line: line.at,
				endLine: line.at,
				schedules: 1,
				block,
				context,
				deck
			})
		);
	}
	if (inline.length) return inline;

	// Matched with each fenced line's characters swapped for a placeholder that
	// is neither space nor `=`, so offsets still point into `whole` but no
	// cloze can start, end or sit inside the code.
	const clozes = [...text(body.map((l) => (l.code ? { raw: l.raw.replace(/\S/g, '\0') } : l))).matchAll(CLOZE)];
	if (!clozes.length) return [];
	const whole = text(body);
	return clozes.map((cloze, i) =>
		build({
			kind: 'cloze',
			question: `${whole.slice(0, cloze.index)}[…]${whole.slice(cloze.index + cloze[0].length)}`,
			answer: cloze[1],
			line: body[0].at,
			endLine: body[body.length - 1].at,
			schedules: clozes.length,
			index: i,
			block,
			context,
			deck
		})
	);
}

/**
 * Attach a card to its schedule comment, which is the next line after the
 * card inside the same paragraph, and read the schedule out of it.
 */
function build(spec: {
	kind: CardKind;
	question: string;
	answer: string;
	line: number;
	endLine: number;
	schedules: number;
	index?: number;
	block: Array<{ at: number; raw: string }>;
	context: string;
	deck: string;
}): Card {
	const after = spec.block.find((l) => l.at === spec.endLine + 1 && isSchedule(l.raw));
	const index = spec.index ?? 0;
	const entries = after ? parseEntries(after.raw) : [];
	const entry = entries[index] ?? null;
	const anchor = after ?? spec.block.find((l) => l.at === spec.endLine)!;
	return {
		// Filled in by `scanCards`, which is the only thing that knows the path.
		path: '',
		kind: spec.kind,
		question: spec.question,
		answer: spec.answer,
		line: spec.line,
		endLine: spec.endLine,
		context: spec.context,
		deck: spec.deck,
		schedule: entry,
		index,
		siblings: Math.max(spec.schedules, entries.length || 1),
		scheduleLine: anchor.at,
		scheduleExists: after !== undefined,
		expectedRaw: anchor.raw
	};
}

/** True for a line that is only a schedule comment, prosoche's or the plugin's. */
function isSchedule(raw: string): boolean {
	const trimmed = raw.trim();
	return (trimmed.startsWith(OPEN) || trimmed.startsWith(SR_OPEN)) && trimmed.endsWith(CLOSE);
}

const DAY = String.raw`\d{4}-\d{2}-\d{2}`;
const NUM = String.raw`\d+(?:\.\d+)?`;
const ENTRY = new RegExp(`^(${DAY}),(${NUM}),(${NUM}),(\\d+),(\\d+),(${STATES.join('|')}),(${DAY})$`);

/**
 * The schedules in one comment, in order, null for a side never answered, so
 * a new cloze deletion inside a reviewed card is still offered. Pure.
 *
 * Reads prosoche's `<!--fsrs:…-->` and the plugin's `<!--SR:…-->`, whose
 * SM-2 entries become FSRS state through `fromSm2`. Of the plugin's forms it
 * accepts the current `!date,interval,ease`, the older one without the `!`,
 * a fractional interval (rounded, as older versions wrote them) and its
 * magic date for a new sibling. An entry it cannot read is null.
 */
export function parseEntries(comment: string): Array<Schedule | null> {
	const trimmed = comment.trim();
	if (trimmed.startsWith(OPEN)) {
		return trimmed.slice(OPEN.length, -CLOSE.length).split('!').map((part) => {
			const m = ENTRY.exec(part.trim());
			if (!m) return null;
			const [, due, stability, difficulty, reps, lapses, state, last] = m;
			return { due, stability: Number(stability), difficulty: Number(difficulty), reps: Number(reps), lapses: Number(lapses), state: state as CardState, last };
		});
	}
	const inner = trimmed.slice(SR_OPEN.length, -CLOSE.length);
	const parts = inner.startsWith('!') ? inner.split('!').filter(Boolean) : [inner];
	return parts.map((part) => {
		const m = /^(\d{4}-\d{2}-\d{2}),([\d.]+),(\d+)/.exec(part.trim());
		if (!m || m[1] === NEW_CARD_DATE) return null;
		return fromSm2(m[1], Math.round(Number(m[2])), Number(m[3]));
	});
}

/**
 * One `<!--fsrs:…-->` comment holding `siblings` schedules, with `index`
 * replaced and the others as `entries` has them, `new` where there is none.
 * Pure.
 */
export function formatComment(
	entries: Array<Schedule | null>,
	index: number,
	siblings: number,
	replacement: Schedule
): string {
	const out: string[] = [];
	for (let i = 0; i < Math.max(siblings, index + 1); i++) {
		const e = i === index ? replacement : (entries[i] ?? null);
		out.push(e ? [e.due, e.stability, e.difficulty, e.reps, e.lapses, e.state, e.last].join(',') : NEW);
	}
	return `${OPEN}${out.join('!')}${CLOSE}`;
}

/** Where a separator starts in a masked line, or null when it is not there. */
function splitAt(masked: string, separator: string): number | null {
	const at = masked.indexOf(separator);
	if (at <= 0) return null;
	// `:::` must not be read as `::`, and a `::` inside `:::` is not a card.
	if (separator === '::' && masked.slice(at, at + 3) === ':::') return null;
	return at;
}

function text(lines: Array<{ raw: string }>): string {
	return lines.map((l) => l.raw.trimEnd()).join('\n').trim();
}

/** The note title and the headings a card sits under. */
function context(title: string, trail: Array<{ text: string }>): string {
	return [title, ...trail.map((t) => t.text)].join(' › ');
}

/** `#flashcards/<deck>` names the deck; otherwise the note's folder does. */
function deckOf(tags: string[], path: string): string {
	const tagged = tags.find((t) => t.startsWith(`${FLASHCARD_TAG}/`));
	if (tagged) return tagged.slice(FLASHCARD_TAG.length + 1);
	const folder = path.split('/').slice(0, -1).pop();
	return folder ?? basename(path);
}

/** First body line, so frontmatter is never scanned for cards. */
function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== '---') return 0;
	for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') return i + 1;
	return 0;
}

/**
 * Blank out inline code spans, keeping every other character at its original
 * offset so a match's index still points into the raw line. `parse/note.ts`
 * has the same trick for tags but keeps it private; duplicating six lines is
 * cheaper here than widening that module's interface for one caller.
 */
function maskCode(line: string): string {
	let out = '';
	for (let i = 0; i < line.length; ) {
		if (line[i] === '`') {
			const close = line.indexOf('`', i + 1);
			if (close === -1) return out + ' '.repeat(line.length - i);
			out += ' '.repeat(close - i + 1);
			i = close + 1;
		} else {
			out += line[i];
			i++;
		}
	}
	return out;
}

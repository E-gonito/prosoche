/**
 * Flashcards: finding them in the vault's markdown, and writing reviews back.
 *
 * Cards are not stored anywhere. They are regions of the user's notes, written
 * in Obsidian Spaced Repetition's syntax, and their review state is the
 * `<!--SR:!date,interval,ease-->` comment the plugin reads and writes. This
 * module is the only place that knows that syntax, and it is the only place
 * that writes it. Nothing about a card lives in SQLite, so a card reviewed in
 * Obsidian is due correctly here and the other way round, and deleting the
 * index changes nothing.
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
 */

import { basename, parseNote } from '../parse/note';
import { scopedNotes } from './topics';
import { isDue, schedule as nextSchedule, type Grade, type Schedule } from '$lib/shared/sm2';
import type { Card, CardKind, CardQueue, StudyScope } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';

export type { Card, CardKind, CardQueue, StudyScope };

/** Separators, as configured in this vault's plugin settings. */
const SEPARATORS: Array<{ text: string; kind: CardKind }> = [
	{ text: ':::', kind: 'inline-reversed' },
	{ text: '::', kind: 'inline' }
];
const MULTILINE: Record<string, CardKind> = { '?': 'multiline', '??': 'multiline-reversed' };

const SR_OPEN = '<!--SR:';
const SR_CLOSE = '-->';
/** The plugin's stand-in due date for a sibling card that is still new. */
const NEW_CARD_DATE = '2000-01-01';

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
 * Never returns a card whose question or answer is empty, and never looks
 * inside a fenced block or an inline code span.
 */
export function scanCards(content: string, path: string): Card[] {
	const lines = content.split('\n');
	const parsed = parseNote(content, path);
	const deck = deckOf(parsed.tags, path);
	const cards: Card[] = [];

	let fence: string | null = null;
	let trail: Array<{ level: number; text: string }> = [];
	let block: Array<{ at: number; raw: string; masked: string }> = [];

	const flush = () => {
		if (block.length) {
			for (const card of cardsInBlock(block, context(parsed.title, trail), deck)) cards.push({ ...card, path });
		}
		block = [];
	};

	for (let i = frontmatterEnd(lines); i < lines.length; i++) {
		const raw = lines[i];
		const f = FENCE.exec(raw);
		if (f) {
			flush();
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;

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
		block.push({ at: i, raw, masked: maskCode(raw) });
	}
	flush();
	return cards;
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
	return tagged || content.includes(SR_OPEN);
}

export interface DueQuery {
	/** Folders and note tags that say what is in scope. Empty is the whole vault. */
	scope?: StudyScope;
	/** The day to schedule against, `YYYY-MM-DD`. */
	on: string;
	/** How many cards to return. The counts describe everything found. */
	limit?: number;
}

/**
 * The cards to review, and what else is in scope.
 *
 * Ordered most overdue first, then cards never reviewed, then by position in
 * the vault. Deliberately deterministic where the plugin shuffles, so a review
 * session can be resumed and a test can name a card.
 *
 * Reads every markdown file in scope, because review state lives in the
 * markdown and the index holds no card table. That is a few hundred small
 * files for this vault, and it is the price of the state being in the notes.
 *
 * Never writes. Never throws: a note that cannot be read contributes nothing.
 */
export async function dueCards(vault: Vault, index: NoteIndex, query: DueQuery): Promise<CardQueue> {
	const cards: Card[] = [];
	const invisible: CardQueue['invisible'] = [];
	let total = 0;

	for (const { path, content, parsed } of await scopedNotes(vault, query.scope)) {
		const found = scanCards(content, path);
		if (!found.length) continue;
		if (isCardSource(parsed.tags, content)) {
			total += found.length;
			cards.push(...found);
		} else {
			// Only cards the user clearly wrote as cards. A `==highlight==` in an
			// untagged note is emphasis: this vault has a speech transcript with
			// twenty of them, and reporting those as missing flashcards would be
			// noise rather than a nudge.
			const explicit = found.filter((c) => c.kind !== 'cloze').length;
			if (explicit) invisible.push({ path, title: index.noteTitle(path) ?? parsed.title, cards: explicit });
		}
	}

	const ready = cards.filter((c) => isDue(c.schedule, query.on));
	ready.sort(byUrgency);
	return {
		cards: ready.slice(0, query.limit ?? 200),
		due: ready.filter((c) => c.schedule !== null).length,
		fresh: ready.filter((c) => c.schedule === null).length,
		total,
		invisible: invisible.sort((a, b) => b.cards - a.cards)
	};
}

export type Reviewed =
	| {
			ok: true;
			card: Card;
			/** Set when a comment was inserted, so a caller holding other cards
			 *  from the same note can move their line numbers on. */
			shift: { path: string; afterLine: number; by: number } | null;
	  }
	| { ok: false; reason: 'no-note' | 'changed'; current: string | null };

/**
 * Grade a card and write its new schedule into the note.
 *
 * One line changes: the card's `<!--SR:-->` comment is rewritten in place, or,
 * when the card has never been reviewed, one comment line is inserted directly
 * after the card. Every other byte of the note is left alone, and no note is
 * ever re-serialised from a parsed model.
 *
 * The comment is written in the plugin's own format, including the sibling
 * schedules of a cloze's other deletions, so Obsidian reads back exactly what
 * it would have written itself.
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

	const schedule = nextSchedule(card.schedule, grade, today);
	const entries = card.scheduleExists ? parseEntries(card.expectedRaw) : [];
	const comment = formatComment(entries, card.index, card.siblings, schedule);

	let shift: { path: string; afterLine: number; by: number } | null = null;
	if (card.scheduleExists) {
		// Keep whatever indentation the comment already had: those bytes are the
		// user's, or the plugin's, and not ours to tidy.
		lines[card.scheduleLine] = `${/^[ \t]*/.exec(at)![0]}${comment}`;
	} else {
		// Column zero, because that is the only place the plugin looks for an
		// inline card's comment.
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
	block: Array<{ at: number; raw: string; masked: string }>,
	context: string,
	deck: string
): Card[] {
	const body = block.filter((l) => !isSchedule(l.raw));
	if (!body.length) return [];

	const separator = body.findIndex((l) => MULTILINE[l.raw.trim()] !== undefined);
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

	const clozes = [...text(body).matchAll(CLOZE)];
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

/** True for a line that is only a schedule comment. */
function isSchedule(raw: string): boolean {
	const trimmed = raw.trim();
	return trimmed.startsWith(SR_OPEN) && trimmed.endsWith(SR_CLOSE);
}

/**
 * The schedules in one comment, in order. A sibling that has never been
 * reviewed is stored with the plugin's magic date and reads back as null, so a
 * new cloze deletion inside a reviewed card is still offered.
 *
 * Accepts the current `!date,interval,ease` form and the older form without
 * the `!`, and tolerates a fractional interval by rounding it, because older
 * plugin versions wrote them.
 */
export function parseEntries(comment: string): Array<Schedule | null> {
	const inner = comment.trim().slice(SR_OPEN.length, -SR_CLOSE.length);
	const parts = inner.startsWith('!') ? inner.split('!').filter(Boolean) : [inner];
	return parts.map((part) => {
		const m = /^(\d{4}-\d{2}-\d{2}),([\d.]+),(\d+)/.exec(part.trim());
		if (!m || m[1] === NEW_CARD_DATE) return null;
		return { due: m[1], interval: Math.round(Number(m[2])), ease: Number(m[3]) };
	});
}

/**
 * One comment holding `siblings` schedules, with `index` replaced. Siblings
 * that are still new keep the plugin's magic date, which is how the plugin
 * itself records "this deletion has not been reviewed".
 */
export function formatComment(
	entries: Array<Schedule | null>,
	index: number,
	siblings: number,
	replacement: Schedule
): string {
	const out: string[] = [];
	for (let i = 0; i < Math.max(siblings, index + 1); i++) {
		const entry = i === index ? replacement : entries[i] ?? null;
		out.push(entry ? `!${entry.due},${entry.interval},${entry.ease}` : `!${NEW_CARD_DATE},1,250`);
	}
	return `${SR_OPEN}${out.join('')}${SR_CLOSE}`;
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

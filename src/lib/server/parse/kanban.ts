/**
 * The Obsidian Kanban plugin's board format: reading a `Board.md` and editing
 * it in place.
 *
 * The format, as the plugin's own serialiser writes it
 * (github.com/mgmeyers/obsidian-kanban, `src/parsers/formats/list.ts`):
 *
 *     ---
 *
 *     kanban-plugin: board
 *
 *     ---
 *
 *     ## To do
 *
 *     - [ ] Order menu printing @{2026-10-03} `Q1` #print
 *     	Two quotes so far; ask Print Co for a third.
 *
 *
 *     ## Done
 *
 *     **Complete**
 *     - [x] Register business name
 *
 *
 *
 *
 *     %% kanban:settings
 *     ```
 *     {"kanban-plugin":"board"}
 *     ```
 *     %%
 *
 * Every heading is a column (the plugin writes `##`, and reads any level); a
 * `(3)` at the end of its title is a WIP limit, and a `**Complete**` line
 * under it means cards moved in are ticked. A card is a top-level `- [ ]`
 * item; its notes are continuation lines, which the plugin indents with a tab
 * or four spaces. `@{YYYY-MM-DD}` (or `@[[YYYY-MM-DD]]` when dates link to
 * daily notes) is a due date, `#tag` a label, and `` `Q1` ``–`` `Q4` `` is
 * this vault's own priority convention, which the plugin shows as inline
 * code. A `***` rule before `## Archive` starts the archive, and the
 * `%% kanban:settings` block closes the file; neither holds columns.
 *
 * The rules this module keeps:
 *
 *  - Nothing is re-serialised. A card edit rewrites spans of its first line,
 *    or replaces its own continuation lines; a move cuts a card's lines and
 *    splices them in elsewhere, byte for byte; a column edit touches only its
 *    heading or its own lines. Every other byte of the file is kept, including
 *    anything this grammar does not understand, and line endings.
 *  - Every function here is pure. No file access, no clock: the day a
 *    quick-add's "fri" means is passed in.
 */

import type { BoardOp } from '$lib/shared/kanban';

/** Half-open character range into one line, without its `\r`. */
export interface Span {
	start: number;
	end: number;
}

/** A card's first line, parsed. Positions are into that line. */
export interface CardLine {
	/** The character inside the brackets. */
	checkChar: string;
	title: string;
	due: string | null;
	priority: number | null;
	labels: string[];
	spans: {
		check: Span;
		/** Where the words start: just after the checkbox and its space. */
		body: number;
		/**
		 * The words: from `body` to the trailing run of due date, priority,
		 * labels and block id. Tokens written in the middle of the words sit
		 * inside this span and are kept when the title is replaced.
		 */
		words: Span;
		/** `@{…}` or `@[[…]]`, the whole token. The last one wins, as in the plugin. */
		due: (Span & { linked: boolean }) | null;
		/** `` `Qn` `` with its backticks. The last one wins. */
		priority: Span | null;
		labels: Array<Span & { label: string }>;
		/** ` ^abc` block id at the end of the line, which the plugin keeps. */
		blockId: Span | null;
		/** End of the line's content, before trailing whitespace. */
		end: number;
	};
}

export interface KanbanCard extends CardLine {
	/** 0-based line of the `- [ ]` line. */
	line: number;
	/** First line after the card: its notes are `line + 1` up to here. */
	end: number;
	done: boolean;
	notes: string;
	/** Indentation of the card's notes, or null when it has none. */
	indent: string | null;
}

export interface KanbanColumn {
	title: string;
	limit: number;
	complete: boolean;
	/** 0-based line of the heading. */
	line: number;
	/** First line after the column's region: the next heading, archive, footer or end. */
	end: number;
	/** The title's span on the heading line, WIP limit excluded. */
	titleSpan: Span;
	cards: KanbanCard[];
}

export interface KanbanBoard {
	columns: KanbanColumn[];
	/** First line after the frontmatter; where a column goes on an empty board. */
	bodyStart: number;
	/** First line past the columns: the archive rule, the settings footer, or the end. */
	tail: number;
	/** The settings footer's JSON, or `{}`. */
	settings: Record<string, unknown>;
}

export type OpResult =
	| { ok: true; content: string }
	| { ok: false; reason: 'no-card' | 'no-column' | 'not-empty' | 'no-text' | 'bad-date' | 'bad-op'; message: string };

/**
 * The board prosoche writes when there is none: the plugin's own serialiser
 * output for To do, Doing and Done with no cards, byte for byte — frontmatter
 * padded with blank lines, three blank lines under each empty column, the
 * settings footer, and no newline at the end.
 */
export const DEFAULT_BOARD = [
	'---',
	'',
	'kanban-plugin: board',
	'',
	'---',
	'',
	'## To do',
	'',
	'',
	'',
	'## Doing',
	'',
	'',
	'',
	'## Done',
	'',
	'',
	'',
	'',
	'',
	'%% kanban:settings',
	'```',
	'{"kanban-plugin":"board"}',
	'```',
	'%%'
].join('\n');

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const CARD = /^( {0,3})([-*+])([ \t]+)\[(.)\]([ \t]*)/;
const LIST_START = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const COMPLETE = /^\*\*Complete\*\*[ \t]*$/;
const FOOTER = /^%% kanban:settings/;
const ARCHIVE = /^ {0,3}#{1,6}[ \t]+Archive[ \t#]*$/;
const WIP = /^(.*?)[ \t]*\((\d+)\)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DUE = /(?<!@)@(?:\{(\d{4}-\d{2}-\d{2})\}|\[\[(\d{4}-\d{2}-\d{2})\]\])/g;
const PRIORITY = /`Q([1-4])`/g;
const BLOCK_ID = /[ \t]\^([a-zA-Z0-9-]+)$/;
const CODE_SPAN = /`[^`]*`/g;
/** Characters that end a tag, from the plugin's own tag tokenizer. */
const TAG_STOP = /[\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]/;

/**
 * Read a board.
 *
 * Never throws. Content that is not a board — no frontmatter, prose between
 * cards, a heading with no cards — still parses: every heading is a column,
 * every top-level task item under one is a card, and everything else is
 * content this module leaves alone.
 */
export function parseBoard(content: string): KanbanBoard {
	const lines = splitLines(content);
	const limit = lineCount(content, lines);
	const bodyStart = frontmatterEnd(lines, limit);

	const columns: KanbanColumn[] = [];
	let current: KanbanColumn | null = null;
	let fence: string | null = null;
	let tail = limit;

	for (let i = bodyStart; i < limit; i++) {
		const text = lines[i];
		if (fence !== null) {
			if (text.trimStart().startsWith(fence)) fence = null;
			continue;
		}
		if (FOOTER.test(text) || (THEMATIC_BREAK.test(text) && ARCHIVE.test(nextNonBlank(lines, i + 1, limit)))) {
			tail = i;
			break;
		}
		const f = FENCE.exec(text);
		if (f) {
			fence = f[1];
			continue;
		}
		if (HEADING.test(text)) {
			if (current) current.end = i;
			current = column(text, i);
			columns.push(current);
			continue;
		}
		if (!current) continue;
		if (COMPLETE.test(text) && current.cards.length === 0) {
			current.complete = true;
			continue;
		}
		const m = CARD.exec(text);
		if (m) {
			const card = readCard(lines, i, limit, m);
			current.cards.push(card);
			i = card.end - 1;
		}
	}
	if (current) current.end = tail;

	return { columns, bodyStart, tail, settings: readSettings(lines, tail, limit) };
}

/**
 * Parse one card line on its own: `- [ ] words @{date} `Q1` #label ^id`.
 * Returns null for a line that is not a top-level task item.
 */
export function parseCardLine(text: string): CardLine | null {
	const m = CARD.exec(text);
	if (!m) return null;
	const checkAt = m[1].length + m[2].length + m[3].length + 1;
	const body = m[0].length;
	const end = trimmedEnd(text, body);

	let due: CardLine['spans']['due'] = null;
	let dueValue: string | null = null;
	for (const d of text.slice(0, end).matchAll(DUE)) {
		if (d.index < body) continue;
		due = { start: d.index, end: d.index + d[0].length, linked: d[2] !== undefined };
		dueValue = d[1] ?? d[2];
	}

	let priority: Span | null = null;
	let priorityValue: number | null = null;
	for (const p of text.slice(0, end).matchAll(PRIORITY)) {
		if (p.index < body) continue;
		priority = { start: p.index, end: p.index + p[0].length };
		priorityValue = Number(p[1]);
	}

	const b = BLOCK_ID.exec(text.slice(0, end));
	const blockId = b && b.index + 1 >= body ? { start: b.index + 1, end } : null;
	const labels = scanLabels(text, body, blockId ? blockId.start : end);

	// The trailing run of tokens, walked back from the end of the line. What
	// is left in front of it is the words, and a token inside the words stays
	// part of them for editing.
	const tokens: Span[] = [...(due ? [due] : []), ...(priority ? [priority] : []), ...labels, ...(blockId ? [blockId] : [])];
	let wordsEnd = end;
	for (let moved = true; moved; ) {
		moved = false;
		for (const token of tokens) {
			if (token.end === wordsEnd && token.start >= body) {
				wordsEnd = trimmedEnd(text, body, token.start);
				moved = true;
			}
		}
	}

	const inWords = tokens.filter((t) => t.start >= body && t.end <= wordsEnd);
	let title = '';
	let from = body;
	for (const token of inWords.sort((x, y) => x.start - y.start)) {
		title += `${text.slice(from, token.start)} `;
		from = token.end;
	}
	title = (title + text.slice(from, wordsEnd)).replace(/[ \t]+/g, ' ').trim();

	return {
		checkChar: m[4],
		title,
		due: dueValue,
		priority: priorityValue,
		labels: labels.map((l) => l.label),
		spans: { check: { start: checkAt, end: checkAt + 1 }, body, words: { start: body, end: wordsEnd }, due, priority, labels, blockId, end }
	};
}

/**
 * Apply one operation to a board's content and return the new content.
 *
 * `today` is `YYYY-MM-DD`, used only to read a quick-add's due word. An op
 * naming a card or column that is not there, a delete of a column that still
 * holds something, an empty title or a malformed date is refused with a
 * reason and a sentence; nothing is half-applied.
 *
 * Every edit is local: see the module comment for exactly what each kind may
 * touch. Never reorders lines except the card or column being moved.
 */
export function applyOp(content: string, op: BoardOp, today: string): OpResult {
	if (!wellFormed(op)) return refuse('bad-op', 'That is not something a board can do.');
	const board = parseBoard(content);
	const file = fileLines(content);
	const lines = file.lines.map(stripCr);
	const done = (next: string[]): OpResult => ({ ok: true, content: file.join(next) });
	/** Rewrite one line's text, keeping a `\r` it may carry in a mixed file. */
	const rewrite = (line: string, text: string) => (line.endsWith('\r') ? `${text}\r` : text);

	switch (op.kind) {
		case 'add-card': {
			const col = board.columns[op.column];
			if (!col) return missing('no-column');
			const parsed = parseQuickAdd(op.text, today);
			if (!parsed.title) return refuse('no-text', 'A card needs some words.');
			const next = [...file.lines];
			next.splice(insertionPoint(lines, col, col.cards.length), 0, composeCard(parsed, board.settings));
			return done(next);
		}
		case 'edit-card': {
			const card = cardAt(board, op.line);
			if (!card) return missing('no-card');
			if (op.due !== undefined && op.due !== null && !isDate(op.due)) return refuse('bad-date', `"${op.due}" is not a date.`);
			if (op.title !== undefined && !oneLine(op.title)) return refuse('no-text', 'A card needs some words.');
			let first = lines[card.line];
			if (op.title !== undefined) first = setTitle(first, oneLine(op.title));
			if (op.due !== undefined) first = setDue(first, op.due, board.settings);
			if (op.priority !== undefined) first = setPriority(first, op.priority);
			if (op.labels !== undefined) first = setLabels(first, op.labels);
			const next = [...file.lines];
			next[card.line] = rewrite(next[card.line], first);
			if (op.notes !== undefined && op.notes.replace(/\s+$/, '') !== card.notes) {
				next.splice(card.line + 1, card.end - card.line - 1, ...noteLines(op.notes, card.indent));
			}
			return done(next);
		}
		case 'toggle-card': {
			const card = cardAt(board, op.line);
			if (!card) return missing('no-card');
			const next = [...file.lines];
			next[card.line] = rewrite(next[card.line], setCheck(lines[card.line], card, op.done));
			return done(next);
		}
		case 'move-card': {
			const card = cardAt(board, op.line);
			if (!card) return missing('no-card');
			if (!board.columns[op.column]) return missing('no-column');
			const from = board.columns.find((c) => c.cards.includes(card))!;
			const cut = file.lines.slice(card.line, card.end);
			const rest = [...file.lines.slice(0, card.line), ...file.lines.slice(card.end)];
			const target = parseBoard(file.join(rest)).columns[op.column];
			// The plugin's rule for a lane marked **Complete**: moving in ticks
			// the card, moving out unticks it, and lanes without the marker
			// leave the checkbox alone.
			if ((from.complete || target.complete) && card.done !== target.complete) {
				cut[0] = rewrite(cut[0], setCheck(lines[card.line], card, target.complete));
			}
			const at = insertionPoint(rest.map(stripCr), target, Math.max(0, Math.min(op.index, target.cards.length)));
			rest.splice(at, 0, ...cut);
			return done(rest);
		}
		case 'add-column': {
			const title = oneLine(op.title);
			if (!title) return refuse('no-text', 'A column needs a name.');
			const next = [...file.lines];
			const before = op.index === undefined ? undefined : board.columns[op.index];
			if (before) {
				next.splice(before.line, 0, `## ${title}`, '', '', '');
			} else {
				const at = columnEnd(lines, board);
				next.splice(at, 0, ...(board.columns.length ? ['', '', `## ${title}`] : [`## ${title}`, '', '', '']));
			}
			return done(next);
		}
		case 'rename-column': {
			const col = board.columns[op.column];
			if (!col) return missing('no-column');
			const title = oneLine(op.title);
			if (!title) return refuse('no-text', 'A column needs a name.');
			const next = [...file.lines];
			next[col.line] = rewrite(next[col.line], splice(lines[col.line], col.titleSpan, title));
			return done(next);
		}
		case 'move-column': {
			const col = board.columns[op.column];
			if (!col) return missing('no-column');
			const cut = file.lines.slice(col.line, col.end);
			const rest = [...file.lines.slice(0, col.line), ...file.lines.slice(col.end)];
			const after = parseBoard(file.join(rest));
			const index = Math.max(0, Math.min(op.index, after.columns.length));
			const at = index < after.columns.length ? after.columns[index].line : after.tail;
			rest.splice(at, 0, ...cut);
			return done(rest);
		}
		case 'delete-column': {
			const col = board.columns[op.column];
			if (!col) return missing('no-column');
			for (let i = col.line + 1; i < col.end; i++) {
				if (lines[i].trim() !== '' && !COMPLETE.test(lines[i])) {
					return refuse('not-empty', `"${col.title}" still has something in it. Move its cards out first.`);
				}
			}
			const next = [...file.lines];
			if (op.column === board.columns.length - 1 && op.column > 0) {
				// The inverse of adding a column at the end: take the blank lines
				// above it with it, and leave the ones below for the footer.
				let from = col.line;
				while (from > board.columns[op.column - 1].line + 1 && lines[from - 1].trim() === '') from--;
				let to = col.line + 1;
				while (to < col.end && COMPLETE.test(lines[to])) to++;
				next.splice(from, to - from);
			} else {
				next.splice(col.line, col.end - col.line);
			}
			return done(next);
		}
	}
}

export interface QuickAdd {
	title: string;
	due: string | null;
	priority: number | null;
	labels: string[];
}

/**
 * Read quick-add text: "Call landlord fri Q1 #legal".
 *
 * `#label` words become labels; a `Q1`–`Q4` word the priority; and one due
 * word the due date: `today`, `tomorrow`, a weekday name or its first three
 * letters (the next such day after `today`, never today itself), `YYYY-MM-DD`
 * or `@{YYYY-MM-DD}`. When there are several, the last one wins and the
 * others stay in the title as words. What is left is the title.
 */
export function parseQuickAdd(text: string, today: string): QuickAdd {
	const words = oneLine(text).split(' ').filter(Boolean);
	const labelOf = (word: string) => {
		const label = /^#(.+)$/.exec(word)?.[1] ?? '';
		return label && !TAG_STOP.test(label) && /\D/.test(label) ? label : null;
	};
	const labels = [...new Set(words.map(labelOf).filter((l): l is string => l !== null))];
	let due: string | null = null;
	let priority: number | null = null;
	const keep: string[] = [];

	for (let i = words.length - 1; i >= 0; i--) {
		const word = words[i];
		if (labelOf(word)) continue;
		const q = /^`?[Qq]([1-4])`?$/.exec(word);
		if (q && priority === null) {
			priority = Number(q[1]);
			continue;
		}
		const day = due === null ? dueWord(word, today) : null;
		if (day) {
			due = day;
			continue;
		}
		keep.unshift(word);
	}
	return { title: keep.join(' '), due, priority, labels };
}

/**
 * Whether an op, which may have come straight off the wire, has the fields
 * its kind needs with the types they need. Positions must be whole numbers.
 */
function wellFormed(op: BoardOp): boolean {
	if (!op || typeof op !== 'object') return false;
	const o = op as unknown as Record<string, unknown>;
	const int = (key: string) => Number.isInteger(o[key]) && (o[key] as number) >= 0;
	const optional = (key: string, type: string) => o[key] === undefined || typeof o[key] === type;
	switch (op.kind) {
		case 'add-card':
			return int('column') && typeof o.text === 'string';
		case 'edit-card':
			return (
				int('line') &&
				optional('title', 'string') &&
				optional('notes', 'string') &&
				(o.due === undefined || o.due === null || typeof o.due === 'string') &&
				(o.priority === undefined || o.priority === null || typeof o.priority === 'number') &&
				(o.labels === undefined || (Array.isArray(o.labels) && o.labels.every((l) => typeof l === 'string')))
			);
		case 'toggle-card':
			return int('line') && typeof o.done === 'boolean';
		case 'move-card':
			return int('line') && int('column') && int('index');
		case 'add-column':
			return typeof o.title === 'string' && (o.index === undefined || int('index'));
		case 'rename-column':
			return int('column') && typeof o.title === 'string';
		case 'move-column':
			return int('column') && int('index');
		case 'delete-column':
			return int('column');
		default:
			return false;
	}
}

/** A card's first line, in the order the spec's example writes it. */
function composeCard(card: QuickAdd, settings: Record<string, unknown>): string {
	const parts = ['- [ ]', card.title];
	if (card.due) parts.push(dueToken(card.due, settings['link-date-to-daily-note'] === true));
	if (card.priority) parts.push(`\`Q${card.priority}\``);
	for (const label of card.labels) parts.push(`#${label}`);
	return parts.join(' ');
}

function column(text: string, line: number): KanbanColumn {
	const h = HEADING.exec(text)!;
	const start = h[0].length;
	// Closing hashes are not part of the title: `## Doing ##`.
	let end = trimmedEnd(text, start);
	const closing = /[ \t]+#+$/.exec(text.slice(start, end));
	if (closing) end = start + closing.index;
	else if (/^#+$/.test(text.slice(start, end))) end = start;
	const raw = text.slice(start, end);
	const wip = WIP.exec(raw);
	const title = wip ? wip[1] : raw;
	return {
		title: title.replace(/<br>/g, ' ').trim(),
		limit: wip ? Number(wip[2]) : 0,
		complete: false,
		line,
		end: line + 1,
		titleSpan: { start, end: start + title.length },
		cards: []
	};
}

/**
 * A card and its continuation lines. A line belongs to the card when it is
 * indented at least as far as the card's content, or when it continues the
 * card's text directly (markdown's lazy continuation). Blank lines belong only
 * when more of the card follows them, so the blank lines after a card are
 * never carried along when it moves.
 */
function readCard(lines: string[], line: number, limit: number, m: RegExpExecArray): KanbanCard {
	const parsed = parseCardLine(lines[line])!;
	const offset = m[1].length + m[2].length + width(m[3]);
	let last = line;
	let previousBlank = false;
	for (let j = line + 1; j < limit; j++) {
		const text = lines[j];
		if (text.trim() === '') {
			previousBlank = true;
			continue;
		}
		const indented = width(/^[ \t]*/.exec(text)![0]) >= offset;
		if (!indented && (previousBlank || !lazy(text))) break;
		last = j;
		previousBlank = false;
	}

	const continuation = lines.slice(line + 1, last + 1);
	const first = continuation.find((l) => /^[ \t]/.test(l));
	return {
		...parsed,
		line,
		end: last + 1,
		done: parsed.checkChar !== ' ',
		notes: continuation.map(dedent).join('\n'),
		indent: first ? (first.startsWith('\t') ? '\t' : /^ */.exec(first)![0].slice(0, 4)) : null
	};
}

/** Whether a line continues the paragraph above it rather than starting a block of its own. */
function lazy(text: string): boolean {
	return !(HEADING.test(text) || LIST_START.test(text) || THEMATIC_BREAK.test(text) || FENCE.test(text) || /^ {0,3}>/.test(text) || FOOTER.test(text));
}

/** One indent off a note line: a tab, or up to four spaces. */
function dedent(text: string): string {
	return text.startsWith('\t') ? text.slice(1) : text.replace(/^ {1,4}/, '');
}

/** New notes as lines under a card, indented the way its notes already are. */
function noteLines(notes: string, indent: string | null): string[] {
	const body = notes.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
	if (!body) return [];
	// Obsidian indents with a tab unless told otherwise, and so does the plugin.
	const unit = indent ?? '\t';
	return body.split('\n').map((l) => (l.trim() === '' ? '' : `${unit}${l}`));
}

/**
 * Where a card lands at `index` in `col`: before the card now at that index,
 * after the last card, or, in an empty column, under whatever is already
 * there, keeping one blank line under a bare heading as the plugin writes it.
 */
function insertionPoint(lines: string[], col: KanbanColumn, index: number): number {
	if (index < col.cards.length) return col.cards[index].line;
	if (col.cards.length) return col.cards[col.cards.length - 1].end;
	let anchor = col.line;
	for (let i = col.line + 1; i < col.end; i++) if (lines[i].trim() !== '') anchor = i;
	if (anchor === col.line && anchor + 1 < col.end && lines[anchor + 1].trim() === '') return anchor + 2;
	return anchor + 1;
}

/**
 * Where a column added at the end goes: straight after the last column's
 * content, so the blank lines before the footer stay below it. On a board
 * with no columns, after the frontmatter and one blank line.
 */
function columnEnd(lines: string[], board: KanbanBoard): number {
	const from = board.columns.length ? board.columns[board.columns.length - 1].line : board.bodyStart;
	let at = board.columns.length ? from + 1 : from;
	for (let i = from; i < board.tail; i++) if (lines[i].trim() !== '') at = i + 1;
	if (!board.columns.length && at < board.tail && lines[at].trim() === '') at++;
	return at;
}

function cardAt(board: KanbanBoard, line: number): KanbanCard | null {
	for (const col of board.columns) for (const card of col.cards) if (card.line === line) return card;
	return null;
}

function setCheck(text: string, card: CardLine, done: boolean): string {
	return splice(text, card.spans.check, done ? 'x' : ' ');
}

/** Replace the words, keeping any token written in the middle of them. */
function setTitle(text: string, title: string): string {
	const card = parseCardLine(text)!;
	const { words } = card.spans;
	const kept = [card.spans.due, card.spans.priority, ...card.spans.labels]
		.filter((t): t is Span => t !== null && t.start >= words.start && t.end <= words.end)
		.sort((a, b) => a.start - b.start)
		.map((t) => text.slice(t.start, t.end));
	const replacement = [title, ...kept].join(' ');
	return insertToken(text, words, replacement);
}

function setDue(text: string, due: string | null, settings: Record<string, unknown>): string {
	const card = parseCardLine(text)!;
	const span = card.spans.due;
	if (span) return due === null ? removeToken(text, span) : splice(text, span, dueToken(due, span.linked));
	if (due === null) return text;
	const at = card.spans.words.end;
	return insertToken(text, { start: at, end: at }, dueToken(due, settings['link-date-to-daily-note'] === true));
}

function setPriority(text: string, priority: number | null): string {
	const card = parseCardLine(text)!;
	const span = card.spans.priority;
	const valid = priority !== null && Number.isInteger(priority) && priority >= 1 && priority <= 4;
	if (span) return valid ? splice(text, span, `\`Q${priority}\``) : removeToken(text, span);
	if (!valid) return text;
	const due = card.spans.due;
	const at = due && due.start >= card.spans.words.end ? due.end : card.spans.words.end;
	return insertToken(text, { start: at, end: at }, `\`Q${priority}\``);
}

/** Make the line's labels exactly `labels`: remove the others, append the new ones. */
function setLabels(text: string, labels: string[]): string {
	const wanted = [...new Set(labels.map(cleanLabel).filter(Boolean))];
	let out = text;
	for (;;) {
		const card = parseCardLine(out)!;
		const stale = [...card.spans.labels].reverse().find((l) => !wanted.includes(l.label));
		if (!stale) break;
		out = removeToken(out, stale);
	}
	for (const label of wanted) {
		const card = parseCardLine(out)!;
		if (card.labels.includes(label)) continue;
		const last = card.spans.labels[card.spans.labels.length - 1];
		const at = last ? last.end : card.spans.blockId ? card.spans.blockId.start : card.spans.end;
		out = insertToken(out, { start: at, end: at }, `#${label}`);
	}
	return out;
}

/** A label as the plugin's tokenizer would read it: no `#`, no stop characters. */
function cleanLabel(label: string): string {
	const bare = label.trim().replace(/^#+/, '').replace(/\s+/g, '-');
	let out = '';
	for (const ch of bare) {
		if (TAG_STOP.test(ch)) break;
		out += ch;
	}
	return /\D/.test(out) ? out : '';
}

function dueToken(due: string, linked: boolean): string {
	return linked ? `@[[${due}]]` : `@{${due}}`;
}

/** Replace `span` with `token`, adding a space either side where it would touch a word. */
function insertToken(text: string, span: Span, token: string): string {
	if (!token) return removeToken(text, span);
	const before = span.start > 0 && !/[ \t]/.test(text[span.start - 1]) ? ' ' : '';
	const after = span.end < text.length && !/[ \t\r]/.test(text[span.end]) ? ' ' : '';
	return text.slice(0, span.start) + before + token + after + text.slice(span.end);
}

/** Remove a token and the whitespace in front of it, or behind it when it opens the line. */
function removeToken(text: string, span: Span): string {
	let { start, end } = span;
	const body = CARD.exec(text)?.[0].length ?? 0;
	// The space in front, unless that is the one separating the checkbox from
	// the words: then the space behind goes instead.
	const opensLine = start <= body && end < trimmedEnd(text, 0);
	if (!opensLine && start > 0 && /[ \t]/.test(text[start - 1])) {
		while (start > 0 && /[ \t]/.test(text[start - 1])) start--;
	} else {
		while (end < text.length && /[ \t]/.test(text[end])) end++;
	}
	return text.slice(0, start) + text.slice(end);
}

function splice(text: string, span: Span, value: string): string {
	return text.slice(0, span.start) + value + text.slice(span.end);
}

/** Every `#label` between `from` and `to`, outside inline code, as the plugin reads tags. */
function scanLabels(text: string, from: number, to: number): Array<Span & { label: string }> {
	const masked = text.slice(0, to).replace(CODE_SPAN, (s) => ' '.repeat(s.length));
	const out: Array<Span & { label: string }> = [];
	for (let i = from; i < to; i++) {
		if (masked[i] !== '#' || (i > 0 && !/\s/.test(masked[i - 1]))) continue;
		let j = i + 1;
		while (j < to && !TAG_STOP.test(masked[j])) j++;
		const label = text.slice(i + 1, j);
		if (label && /\D/.test(label)) out.push({ start: i, end: j, label });
		i = j - 1;
	}
	return out;
}

function dueWord(word: string, today: string): string | null {
	const w = word.toLowerCase();
	const braced = /^@\{(\d{4}-\d{2}-\d{2})\}$/.exec(word);
	if (braced && isDate(braced[1])) return braced[1];
	if (DATE.test(word) && isDate(word)) return word;
	if (w === 'today') return today;
	if (w === 'tomorrow' || w === 'tmrw') return addDays(today, 1);
	const day = WEEKDAYS.findIndex((names) => names.includes(w));
	if (day === -1) return null;
	const from = weekday(today);
	return addDays(today, ((day - from + 6) % 7) + 1);
}

/** Sunday first, as `Date#getUTCDay` counts. */
const WEEKDAYS = [
	['sun', 'sunday'],
	['mon', 'monday'],
	['tue', 'tues', 'tuesday'],
	['wed', 'wednesday'],
	['thu', 'thur', 'thurs', 'thursday'],
	['fri', 'friday'],
	['sat', 'saturday']
];

function isDate(value: string): boolean {
	if (!DATE.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function weekday(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function missing(reason: 'no-card' | 'no-column'): OpResult {
	return refuse(reason, reason === 'no-card' ? 'That card is not on the board any more.' : 'That column is not on the board any more.');
}

function refuse(reason: Exclude<OpResult, { ok: true }>['reason'], message: string): OpResult {
	return { ok: false, reason, message };
}

/** Visual width of leading whitespace, a tab reaching the next multiple of four. */
function width(ws: string): number {
	let w = 0;
	for (const ch of ws) w = ch === '\t' ? w + 4 - (w % 4) : w + 1;
	return w;
}

function trimmedEnd(text: string, floor: number, from = text.length): number {
	let end = from;
	while (end > floor && /[ \t\r]/.test(text[end - 1])) end--;
	return end;
}

function nextNonBlank(lines: string[], from: number, limit: number): string {
	for (let i = from; i < limit; i++) if (lines[i].trim() !== '') return lines[i];
	return '';
}

/** First line after the frontmatter, or 0 when the file has none. */
function frontmatterEnd(lines: string[], limit: number): number {
	if (limit === 0 || lines[0].trimEnd() !== '---') return 0;
	for (let i = 1; i < limit; i++) if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) return i + 1;
	return 0;
}

/** The settings footer's JSON, which may sit below the archive. `{}` when there is none or it will not parse. */
function readSettings(lines: string[], tail: number, limit: number): Record<string, unknown> {
	let footer = tail;
	while (footer < limit && !FOOTER.test(lines[footer])) footer++;
	if (footer >= limit) return {};
	const body: string[] = [];
	for (let i = footer + 1; i < limit && !/^%%/.test(lines[i]); i++) if (!/^```/.test(lines[i])) body.push(lines[i]);
	try {
		const parsed = JSON.parse(body.join('\n'));
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * A file as lines, and the way to put it back together.
 *
 * A file that ends every line with `\r\n` is split and joined on it, so a
 * line added to it gets the same ending. Anything else is split on `\n`
 * alone and each line keeps whatever `\r` it had, so a mixed file is not
 * normalised either.
 */
function fileLines(content: string): { lines: string[]; join: (lines: string[]) => string } {
	const raw = content.split('\n');
	const crlf = raw.length > 1 && raw.slice(0, -1).every((l) => l.endsWith('\r'));
	if (!crlf) return { lines: raw, join: (lines) => lines.join('\n') };
	return { lines: raw.map(stripCr), join: (lines) => lines.join('\r\n') };
}

function stripCr(line: string): string {
	return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** The content's lines without their `\r`. */
function splitLines(content: string): string[] {
	return content.split('\n').map(stripCr);
}

/** How many real lines there are: a trailing newline does not start another. */
function lineCount(content: string, lines: string[]): number {
	if (content === '') return 0;
	return content.endsWith('\n') ? lines.length - 1 : lines.length;
}

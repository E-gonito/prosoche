/**
 * A book's note in the vault, `Books/<Title>.md`: the author's own record of
 * the book, in git and readable in Obsidian. Everything here is pure text in,
 * text out.
 *
 *     ---
 *     book: <id>
 *     format: pdf
 *     source: "<url or file name>"
 *     added: "2026-10-23"
 *     at: p. 412
 *     read_at: "2026-10-23"
 *     ---
 *
 *     ## Highlights
 *
 *     - > the quoted words — p. 412
 *     	- the author's comment
 *
 * Writers follow the vault's rule: change the one field or add the one line,
 * and keep every other byte. Nothing re-serialises the note from a parsed
 * model. This is the only file that knows this note's grammar.
 */

import { isBookId } from './id';
import { setFrontmatterField } from '../parse/frontmatter';
import { BOOK_FORMATS, parsePlace, placeText, type BookFormat, type Highlight, type Place } from '$lib/shared/books';

/** What `readBookNote` finds. */
export interface BookNote {
	id: string;
	format: BookFormat;
	source: string;
	/** `at:`, or null when the author has not opened the book or the value is not a place. */
	at: Place | null;
	/** `read_at:` as written, or null. */
	readAt: string | null;
	highlights: Highlight[];
}

/** The longest a quote may be, in characters, ellipsis included. */
export const MAX_QUOTE = 1000;

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const SEPARATOR = ' — ';

/**
 * Read a book note. Null unless its `book:` is a valid book id
 * (`isBookId`) and its `format:` is one of the three formats: such a note is
 * not one this feature wrote. `source` is empty when missing. Highlights are
 * the `- > ` lines under the `## Highlights` heading, up to the next heading
 * of level 1 or 2; the place is what follows the line's LAST ` — `, and the
 * comment is the tab-indented `- ` line right after it, if any. A highlight
 * line that does not parse is skipped. `line` is the 0-based line of the
 * `- >` line in `content`. Pure; never throws.
 */
export function readBookNote(content: string): BookNote | null {
	const fields = frontmatterFields(content);
	const id = fields.get('book');
	const format = fields.get('format');
	if (!isBookId(id) || !format || !BOOK_FORMATS.includes(format as BookFormat)) return null;
	return {
		id,
		format: format as BookFormat,
		source: fields.get('source') ?? '',
		at: parsePlace(fields.get('at')),
		readAt: fields.get('read_at') || null,
		highlights: readHighlights(content)
	};
}

/**
 * The text of a new book note: its frontmatter and nothing else; the
 * `## Highlights` heading appears with the first highlight. `at:` and
 * `read_at:` are absent until the book is first read. `added` is a
 * `YYYY-MM-DD` day. Pure.
 */
export function newBookNote(book: { id: string; format: BookFormat; source: string; added: string }): string {
	let text = '';
	for (const [key, value] of [['book', book.id], ['format', book.format], ['source', book.source], ['added', book.added]] as const) {
		text = setFrontmatterField(text, key, value);
	}
	return text;
}

/**
 * Record where the author is: `at:` is `placeText(place)` and `read_at:` is
 * `day` (`YYYY-MM-DD`). Both fields are set the way every frontmatter field
 * is (see `setFrontmatterField`); every other byte of the note is kept.
 * Pure.
 */
export function setPlace(content: string, place: Place, day: string): string {
	return setFrontmatterField(setFrontmatterField(content, 'at', placeText(place)), 'read_at', day);
}

/**
 * A quote as it is stored on one line: runs of whitespace become single
 * spaces, ends trimmed, and anything over `MAX_QUOTE` characters is cut so
 * that the result, with its closing `…`, is `MAX_QUOTE` long. Empty when
 * nothing is left. Pure.
 */
export function cleanQuote(quote: string): string {
	const q = quote.replace(/\s+/g, ' ').trim();
	return q.length > MAX_QUOTE ? `${q.slice(0, MAX_QUOTE - 1).trimEnd()}…` : q;
}

/**
 * Add one highlight as the last item under `## Highlights`, creating that
 * heading at the end of the note (after exactly one blank line) when the
 * note has none. The line is `- > <quote> — <placeText(place)>` with the
 * quote as `cleanQuote` makes it; a non-empty `comment`, whitespace
 * collapsed, goes on the next line as `\t- <comment>`. Nothing else in the
 * note changes, except that trailing blank lines at the end of the note are
 * replaced by the one blank line when the heading is created. A quote with
 * nothing in it adds nothing: the note comes back as it was. Pure.
 */
export function addHighlight(content: string, h: { quote: string; place: Place; comment?: string }): string {
	const quote = cleanQuote(h.quote);
	if (!quote) return content;
	const eol = content.includes('\r\n') ? '\r\n' : '\n';
	const comment = (h.comment ?? '').replace(/\s+/g, ' ').trim();
	const item = [`- > ${quote}${SEPARATOR}${placeText(h.place)}`, ...(comment ? [`\t- ${comment}`] : [])];

	const lines = content.split('\n');
	const section = findSection(lines);
	if (!section) {
		const head = content.replace(/(?:\r?\n[ \t]*)+$/, '');
		const block = ['## Highlights', '', ...item].join(eol);
		return head ? `${head}${eol}${eol}${block}${eol}` : `${block}${eol}`;
	}

	const { heading, end } = section;
	let last = heading;
	for (let i = end - 1; i > heading; i--) {
		if (lines[i].trim() !== '') {
			last = i;
			break;
		}
	}
	const cr = lines[heading].endsWith('\r') ? '\r' : '';
	const out = item.map((l) => l + cr);
	if (last > heading) lines.splice(last + 1, 0, ...out);
	else if (lines[heading + 1] !== undefined && lines[heading + 1].trim() === '' && heading + 1 < lines.length - 1) lines.splice(heading + 2, 0, ...out);
	else lines.splice(heading + 1, 0, cr, ...out, ...(heading + 1 === end && end < lines.length ? [cr] : []));
	return lines.join('\n');
}

/** The `## Highlights` heading's line and the line its section ends before, or null. */
function findSection(lines: string[]): { heading: number; end: number } | null {
	const start = bodyStart(lines);
	let heading = -1;
	for (let i = start; i < lines.length; i++) {
		const h = HEADING.exec(lines[i].replace(/\r$/, ''));
		if (!h) continue;
		if (heading === -1) {
			if (h[1].length === 2 && h[2].toLowerCase() === 'highlights') heading = i;
		} else if (h[1].length <= 2) return { heading, end: i };
	}
	return heading === -1 ? null : { heading, end: lines.length };
}

function readHighlights(content: string): Highlight[] {
	const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
	const section = findSection(lines);
	if (!section) return [];
	const out: Highlight[] = [];
	for (let i = section.heading + 1; i < section.end; i++) {
		if (!lines[i].startsWith('- > ')) continue;
		const rest = lines[i].slice(4);
		const cut = rest.lastIndexOf(SEPARATOR);
		if (cut < 0) continue;
		const quote = rest.slice(0, cut).trim();
		const place = parsePlace(rest.slice(cut + SEPARATOR.length));
		if (!quote || !place) continue;
		const next = i + 1 < section.end ? /^\t- (.+)$/.exec(lines[i + 1]) : null;
		out.push({ quote, place, ...(next ? { comment: next[1].trim() } : {}), line: i });
	}
	return out;
}

/** The first line after a frontmatter block, or 0 when the note has none. */
function bodyStart(lines: string[]): number {
	if (lines[0]?.replace(/\r$/, '') !== '---') return 0;
	const close = lines.findIndex((l, i) => i > 0 && l.replace(/\r$/, '') === '---');
	return close < 0 ? 0 : close + 1;
}

/**
 * Top-level `key: value` lines of the frontmatter as text, unquoted. Read as
 * text rather than through a YAML parser so an id of digits only is not read
 * as a number and a date is not read as a `Date`.
 */
function frontmatterFields(content: string): Map<string, string> {
	const fields = new Map<string, string>();
	const lines = content.split('\n').map((l) => l.replace(/\r$/, ''));
	const end = bodyStart(lines);
	for (let i = 1; i < end - 1; i++) {
		const m = /^([A-Za-z_][\w-]*):[ \t]*(.*?)[ \t]*$/.exec(lines[i]);
		if (m && !fields.has(m[1])) fields.set(m[1], unquote(m[2]));
	}
	return fields;
}

function unquote(raw: string): string {
	if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
		try {
			const v: unknown = JSON.parse(raw);
			if (typeof v === 'string') return v;
		} catch {
			// Not valid JSON escapes; use it as written.
		}
		return raw.slice(1, -1);
	}
	if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
	return raw;
}

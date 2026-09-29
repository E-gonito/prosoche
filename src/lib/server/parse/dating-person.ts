/**
 * The two pieces of grammar a dating person's note adds to the shared person
 * format (`people.ts`): the `## Dates` log line, and the frontmatter
 * `stage:` field.
 *
 *     ---
 *     type: person
 *     stage: dating
 *     ---
 *     ## Dates
 *     - 2026-09-20 Coffee at Monmouth rating:: 4 cost:: 9 notes:: easy conversation
 *
 * A dates line is append-only, exactly like `people.ts`'s `## Log` — a new
 * date is always appended with `appendUnderHeading`, so this file only needs
 * to parse the lines that are already there and to build the text of a new
 * one. `stage:` is different: it is one frontmatter field that changes in
 * place as a relationship moves along, so it is rewritten through
 * `frontmatter.ts`'s span edit, which every frontmatter field shares.
 */

import type { DayKey } from '../daily';
import { scanInlineFields } from './inline-fields';

export interface DateEntry {
	/** 0-based line index within the file. */
	line: number;
	day: DayKey;
	/** The words between the date and the first recognised field, e.g. "Coffee at Monmouth". */
	text: string;
	rating: number | null;
	cost: number | null;
	notes: string;
	raw: string;
}

const BULLET = /^([ \t]*[-*+][ \t]+)(\d{4}-\d{2}-\d{2})(?=[ \t]|$)/;
const KEYS = ['rating', 'cost', 'notes'] as const;
type Key = (typeof KEYS)[number];

/** Parse one `## Dates` line. Returns null for anything not `- YYYY-MM-DD …`. */
export function parseDateLine(raw: string, line = 0): DateEntry | null {
	const m = BULLET.exec(raw);
	if (!m) return null;

	const prefixEnd = m[0].length;
	const rest = raw.slice(prefixEnd);
	const fields = scanInlineFields(rest, KEYS, 'notes');
	const field = (key: Key) => fields.find((f) => f.key === key);

	const textEnd = fields.length ? fields[0].keyStart : rest.length;
	const text = rest.slice(0, textEnd).trim();

	const number = (key: Key): number | null => {
		const f = field(key);
		if (!f) return null;
		const n = Number.parseFloat(rest.slice(f.valueStart, f.valueEnd));
		return Number.isFinite(n) ? n : null;
	};

	const notesField = field('notes');
	const notes = notesField ? rest.slice(notesField.valueStart, notesField.valueEnd) : '';

	return { line, day: m[2], text, rating: number('rating'), cost: number('cost'), notes, raw };
}

/** Every `- YYYY-MM-DD …` line in a note's content, in file order. */
export function scanDates(content: string): DateEntry[] {
	const out: DateEntry[] = [];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const parsed = parseDateLine(lines[i], i);
		if (parsed) out.push(parsed);
	}
	return out;
}

/** The text of a fresh dates-log line, for `appendUnderHeading` to file. */
export function newDateLine(
	day: DayKey,
	text: string,
	fields: { rating?: number | null; cost?: number | null; notes?: string } = {}
): string {
	const parts = [`- ${day}`];
	const words = text.replace(/\s+/g, ' ').trim();
	if (words) parts.push(words);
	if (fields.rating !== undefined && fields.rating !== null) parts.push(`rating:: ${fields.rating}`);
	if (fields.cost !== undefined && fields.cost !== null) parts.push(`cost:: ${fields.cost}`);
	const notes = (fields.notes ?? '').replace(/\s+/g, ' ').trim();
	if (notes) parts.push(`notes:: ${notes}`);
	return parts.join(' ');
}

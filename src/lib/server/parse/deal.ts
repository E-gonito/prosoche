/**
 * Parsing and span-rewriting the vault's deal lines.
 *
 * A deal is one bullet in a workspace's `Deals.md`, written in Dataview's own
 * inline-field style so it stays readable in Obsidian:
 *
 *     - Moorfields pilot [[Jane Doe]] stage:: proposal value:: 12000 next:: 2026-10-03
 *
 * free text — usually naming the deal and linking the person — followed by
 * any number of `key:: value` fields in the order they were written. Nothing
 * about the set of fields is fixed: this module reads `stage`, `value` and
 * `next` because the pipeline and the "next" date need them, but a field it
 * does not recognise is kept exactly as written, never dropped.
 *
 * Like `parse/task.ts`, every rewrite edits the line through a character
 * span, so a field's own spacing and every other field survive untouched, and
 * nothing here reorders or deletes a line.
 */

/** Half-open character range into the raw line. */
export interface Span {
	start: number;
	end: number;
}

/** One `key:: value` field, with the ranges its key and its value occupy. */
export interface DealField {
	key: string;
	value: string;
	/** Covers `key::`, so it is never mistaken for the value it introduces. */
	keySpan: Span;
	/** Covers only the value's own characters, trimmed of surrounding space. */
	valueSpan: Span;
}

export interface Deal {
	/** 0-based index of this line within the file. */
	line: number;
	/** The line exactly as it appears in the file. */
	raw: string;
	indent: string;
	/** Free text before the fields, wikilinks and all, as written. */
	text: string;
	/** First wikilink target in `text`, or null when the deal names no person. */
	person: string | null;
	/** Every field, in written order. */
	fields: DealField[];
	stage: string | null;
	/** Parsed from the `value` field when it is a plain number, else null. */
	value: number | null;
	next: string | null;
}

const BULLET = /^([ \t]*)([-*+])([ \t]+)/;
/** A checkbox straight after the bullet marks this a task line, not a deal. */
const CHECKBOX = /^\[.\][ \t]/;
const FIELD_KEY = /([A-Za-z][\w-]*)::/g;
const WIKILINK = /\[\[([^\]|#]+)/;

/**
 * Parse one line. Returns null when the line is not a deal: not a bullet at
 * all, or a bullet whose content starts with a checkbox, which is a task
 * line and belongs to `parse/task.ts` instead. A deal needs no field to be
 * recognised — a bare `- Moorfields pilot` is a deal with nothing filled in
 * yet — because the file it lives in is what says these lines are deals.
 */
export function parseDealLine(raw: string, line = 0): Deal | null {
	const m = BULLET.exec(raw);
	if (!m) return null;
	const [matched, indent] = m;
	const bodyStart = matched.length;
	const body = raw.slice(bodyStart);
	if (CHECKBOX.test(body)) return null;

	const hits: Array<{ key: string; at: number; after: number }> = [];
	FIELD_KEY.lastIndex = 0;
	for (let f = FIELD_KEY.exec(body); f; f = FIELD_KEY.exec(body)) {
		hits.push({ key: f[1], at: f.index, after: f.index + f[0].length });
	}

	const contentEnd = endOfContent(body);
	const fields: DealField[] = hits.map((hit, i) => {
		const limit = i + 1 < hits.length ? hits[i + 1].at : contentEnd;
		const region = body.slice(hit.after, limit);
		const trimmed = region.trim();
		const at = trimmed ? hit.after + region.indexOf(trimmed) : hit.after;
		return {
			key: hit.key,
			value: trimmed,
			keySpan: { start: bodyStart + hit.at, end: bodyStart + hit.after },
			valueSpan: { start: bodyStart + at, end: bodyStart + at + trimmed.length }
		};
	});

	const headEnd = hits.length ? hits[0].at : contentEnd;
	const text = body.slice(0, headEnd).trim();
	const link = WIKILINK.exec(text);

	const field = (key: string) => fields.find((f) => f.key === key)?.value ?? null;
	const rawValue = field('value');
	const value = rawValue !== null && rawValue !== '' && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null;

	return {
		line,
		raw,
		indent,
		text,
		person: link ? link[1].trim() : null,
		fields,
		stage: field('stage'),
		value,
		next: field('next')
	};
}

/** Every deal in a note, in file order. Blank lines and prose are skipped. */
export function scanDeals(content: string): Deal[] {
	const deals: Deal[] = [];
	content.split('\n').forEach((raw, line) => {
		const deal = parseDealLine(raw, line);
		if (deal) deals.push(deal);
	});
	return deals;
}

/**
 * Change one field's value, add it when the line has none, or remove it when
 * `value` is null. Returns `raw` unchanged when the line is not a deal, so a
 * caller working from a stale line number cannot corrupt prose.
 *
 * Only the field named survives being touched: every other field, and the
 * spacing around it, is copied across byte for byte. A new field is appended
 * after the last one, which is where this vault's Dataview fields already go.
 */
export function rewriteDealField(raw: string, key: string, value: string | null): string {
	const deal = parseDealLine(raw);
	if (!deal) return raw;
	const existing = deal.fields.find((f) => f.key === key);

	if (value === null) {
		if (!existing) return raw;
		const start = backOverOneSpace(raw, existing.keySpan.start);
		return raw.slice(0, start) + raw.slice(existing.valueSpan.end);
	}

	const clean = value.trim();
	if (existing) {
		return raw.slice(0, existing.valueSpan.start) + clean + raw.slice(existing.valueSpan.end);
	}
	const at = endOfContent(raw);
	return `${raw.slice(0, at)} ${key}:: ${clean}${raw.slice(at)}`;
}

function backOverOneSpace(raw: string, from: number): number {
	return from > 0 && (raw[from - 1] === ' ' || raw[from - 1] === '\t') ? from - 1 : from;
}

/** Index after the last non-space character of the string. */
function endOfContent(raw: string): number {
	let i = raw.length;
	while (i > 0 && (raw[i - 1] === ' ' || raw[i - 1] === '\t' || raw[i - 1] === '\r')) i--;
	return i;
}

/**
 * The glossary grammar: `<home>/Glossary.md`, one `##` heading per term.
 *
 *     ## DVC
 *     - guess:: Data version control, keep track of model output
 *     - status:: looked-up
 *     - category:: ML
 *     - source:: [[2026-09-28 Dev Weekly]]
 *     - drafted:: Claude
 *
 *     Open-source tool that versions datasets and models alongside git…
 *
 *     → For Eye2Gene, DVC makes training data and model artifacts traceable…
 *
 * An entry runs from its heading to the next `#` or `##` heading, so a `###`
 * inside an entry belongs to it. Fields are top-level `- key:: value`
 * bullets, the relevance line starts with `→`, and everything else in the
 * entry is its definition. Text above the first entry is the note's own and
 * is never touched.
 *
 * Every edit here is a span edit or an insertion: a field's value is
 * replaced inside its line, new lines are spliced in, and no function
 * rebuilds a note from the parsed entries.
 */

import { normaliseTerm } from '$lib/shared/glossary';

export interface GlossaryField {
	value: string;
	/** 0-based line of the field in the note. */
	line: number;
	/** Where the value sits inside that line, so it can be replaced alone. */
	start: number;
	end: number;
}

export interface GlossaryEntry {
	term: string;
	/** 0-based line of the `## Term` heading. */
	line: number;
	/** Last line of the entry, inclusive, trailing blank lines included. */
	end: number;
	/** Keyed by lower-case field name; the first occurrence wins. */
	fields: Record<string, GlossaryField>;
	guess: string | null;
	/** As written, lower-cased: usually `looked-up` or `to-look-up`. */
	status: string | null;
	category: string | null;
	/** The source as written, e.g. `[[2026-09-28 Dev Weekly]]`. */
	source: string | null;
	/** The entry's prose, blank lines at either end trimmed; '' when none. */
	definition: string;
	/** The text after `→`, or null. */
	relevance: string | null;
	/**
	 * True when the entry still needs looking up: its status says
	 * `to-look-up`, or it has no status and no definition either.
	 */
	pending: boolean;
}

/** A term to add, as "Add to glossary" writes it. */
export interface NewEntry {
	term: string;
	guess?: string | null;
	status?: string;
	category?: string | null;
	source?: string | null;
}

const FENCE = /^[ \t]*(```|~~~)/;
const ENTRY = /^##[ \t]+(.+?)[ \t]*#*[ \t]*\r?$/;
const BOUNDARY = /^#{1,2}[ \t]/;
const FIELD_LINE = /^([-*+][ \t]+)([A-Za-z][\w-]*)::[ \t]*/;
const RELEVANCE = /^[ \t]*→[ \t]*(.*?)[ \t]*\r?$/;

/**
 * Every entry, in file order. Pure. Headings inside fenced blocks are text,
 * not entries.
 */
export function parseGlossary(content: string): GlossaryEntry[] {
	const lines = content.split('\n');
	const starts: Array<{ line: number; term: string }> = [];
	const boundaries: number[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;
		if (BOUNDARY.test(lines[i])) {
			boundaries.push(i);
			const m = ENTRY.exec(lines[i]);
			if (m) starts.push({ line: i, term: m[1].trim() });
		}
	}

	return starts.map(({ line, term }) => {
		const next = boundaries.find((b) => b > line);
		const end = (next ?? lines.length) - 1;
		return readEntry(lines, term, line, end);
	});
}

function readEntry(lines: string[], term: string, line: number, end: number): GlossaryEntry {
	const fields: Record<string, GlossaryField> = {};
	const prose: string[] = [];
	let relevance: string | null = null;
	let fence: string | null = null;

	for (let i = line + 1; i <= end; i++) {
		const raw = lines[i].replace(/\r$/, '');
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			prose.push(raw);
			continue;
		}
		if (fence === null) {
			const field = FIELD_LINE.exec(raw);
			if (field) {
				const key = field[2].toLowerCase();
				const start = field[0].length;
				const valueEnd = raw.trimEnd().length;
				if (!(key in fields)) fields[key] = { value: raw.slice(start, valueEnd).trim(), line: i, start, end: Math.max(start, valueEnd) };
				continue;
			}
			const rel = RELEVANCE.exec(raw);
			if (rel && relevance === null) {
				relevance = rel[1];
				continue;
			}
		}
		prose.push(raw);
	}

	const definition = prose.join('\n').replace(/^\s*\n/, '').trim();
	const value = (key: string) => fields[key]?.value || null;
	const status = value('status')?.toLowerCase() ?? null;
	return {
		term,
		line,
		end,
		fields,
		guess: value('guess'),
		status,
		category: value('category'),
		source: value('source'),
		definition,
		relevance,
		pending: status ? status === 'to-look-up' : definition === ''
	};
}

/** The entry for `term`, compared case-insensitively, or null. */
export function findEntry(content: string, term: string): GlossaryEntry | null {
	const wanted = normaliseTerm(term);
	return parseGlossary(content).find((e) => normaliseTerm(e.term) === wanted) ?? null;
}

// How two spellings of a term are compared; shared with the browser, which
// de-duplicates a scan's candidates by the same rule.
export { normaliseTerm };

/**
 * Set one field of one entry. Pure; returns null when there is no such
 * entry.
 *
 * An existing field has only its value replaced, so the bullet and key keep
 * their spelling. A missing field gets a new line after the entry's last
 * field, or straight under the heading when it has none.
 */
export function setField(content: string, term: string, key: string, value: string): string | null {
	const entry = findEntry(content, term);
	if (!entry) return null;
	const lines = content.split('\n');
	const clean = oneLine(value);
	const field = entry.fields[key.toLowerCase()];
	if (field) {
		const raw = lines[field.line];
		lines[field.line] = raw.slice(0, field.start) + clean + raw.slice(field.end);
		return lines.join('\n');
	}
	const lastField = Math.max(entry.line, ...Object.values(entry.fields).map((f) => f.line));
	const cr = lines[entry.line].endsWith('\r') ? '\r' : '';
	lines.splice(lastField + 1, 0, `- ${key}:: ${clean}${cr}`);
	return lines.join('\n');
}

/**
 * Add a definition and a relevance line to the end of one entry. Pure;
 * returns null when there is no such entry.
 *
 * The text goes after the entry's last non-blank line, a blank line either
 * side, and the entry's own trailing blank lines stay below it. A line of the
 * definition that would read as a heading, a field or a relevance line is
 * defused, so the entry parses back the way it was meant.
 */
export function insertDefinition(content: string, term: string, definition: string, relevance: string): string | null {
	const entry = findEntry(content, term);
	if (!entry) return null;
	const lines = content.split('\n');
	let last = entry.end;
	while (last > entry.line && lines[last].trim() === '') last--;

	const block: string[] = [''];
	const prose = defuse(definition);
	if (prose) block.push(...prose.split('\n'), '');
	const why = oneLine(relevance);
	if (why) block.push(`→ ${why}`, '');
	if (block.length === 1) return content;

	// The entry's own blank lines below stay where they are; the block brings
	// its own trailing blank only when there were none, so the next heading
	// (or the end of a file that had no final newline) is still set apart.
	if (last < entry.end) block.pop();
	lines.splice(last + 1, 0, ...block);
	return lines.join('\n');
}

/** What an edit to one entry may change. Absent keys are left as they are. */
export interface EntryChange {
	/** A new name for the term: only the heading's text is rewritten. */
	term?: string;
	/** '' removes the field's line. */
	category?: string;
	status?: string;
	/**
	 * The entry's prose and its `→` line, replaced together: every line of the
	 * entry that is not a field goes, and the new text is written where
	 * `insertDefinition` would put it. Pass both, or neither.
	 */
	body?: { definition: string; relevance: string };
}

/**
 * Edit one entry. Pure; returns null when there is no such entry.
 *
 * Every change is confined to the entry's own lines. The heading keeps its
 * `##` and only its text changes; a field keeps its bullet and key spelling;
 * fields the change does not name (source, drafted, anything else) are left
 * where they are. Replacing the body is the one edit that drops lines, and
 * only the entry's prose and relevance line: its fields and its trailing
 * blank lines stay. Never touches another entry or the text above the first.
 */
export function editEntry(content: string, term: string, change: EntryChange): string | null {
	let next: string | null = content;
	if (change.body) {
		next = clearBody(next, term);
		if (next === null) return null;
		next = insertDefinition(next, term, change.body.definition, change.body.relevance);
	}
	for (const key of ['category', 'status'] as const) {
		const value = change[key];
		if (value === undefined || next === null) continue;
		next = oneLine(value) ? setField(next, term, key, value) : removeField(next, term, key);
	}
	if (next === null) return null;
	if (change.term !== undefined && oneLine(change.term)) {
		const entry = findEntry(next, term)!;
		const lines = next.split('\n');
		const cr = lines[entry.line].endsWith('\r') ? '\r' : '';
		const hashes = /^(##[ \t]+)/.exec(lines[entry.line])![1];
		lines[entry.line] = `${hashes}${oneLine(change.term)}${cr}`;
		next = lines.join('\n');
	}
	return next;
}

/**
 * Remove one entry: its heading and every line up to the next heading,
 * trailing blank lines included, so the entry after it (or the end of the
 * file) closes up the gap. Pure; returns null when there is no such entry.
 */
export function deleteEntry(content: string, term: string): string | null {
	const entry = findEntry(content, term);
	if (!entry) return null;
	const lines = content.split('\n');
	lines.splice(entry.line, entry.end - entry.line + 1);
	// Deleting the last entry of a file that ended in a newline would leave
	// none; put the one it had back.
	if (content.endsWith('\n') && lines.length && lines[lines.length - 1] !== '') lines.push('');
	return lines.join('\n');
}

/** Drop one field's line from one entry, or leave the note as it is. */
function removeField(content: string, term: string, key: string): string | null {
	const entry = findEntry(content, term);
	if (!entry) return null;
	const field = entry.fields[key.toLowerCase()];
	if (!field) return content;
	const lines = content.split('\n');
	lines.splice(field.line, 1);
	return lines.join('\n');
}

/**
 * Remove an entry's prose and relevance line, keeping its heading, its
 * fields (read the same way `readEntry` reads them, outside fences only) and
 * its trailing blank lines.
 */
function clearBody(content: string, term: string): string | null {
	const entry = findEntry(content, term);
	if (!entry) return null;
	const lines = content.split('\n');
	let last = entry.end;
	while (last > entry.line && lines[last].trim() === '') last--;

	const keep: string[] = [];
	let fence: string | null = null;
	for (let i = entry.line + 1; i <= last; i++) {
		const raw = lines[i].replace(/\r$/, '');
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence === null && FIELD_LINE.test(raw)) keep.push(lines[i]);
	}
	lines.splice(entry.line + 1, last - entry.line, ...keep);
	return lines.join('\n');
}

/**
 * Append a new entry at the end of the note. Pure.
 *
 * The note's trailing bytes are kept; only enough newlines are added to put
 * one blank line before the new heading. An empty note gets a `# Glossary`
 * title first. Field order follows the documented format: guess, status,
 * category, source.
 */
export function appendEntry(content: string, entry: NewEntry): string {
	const lines = [`## ${oneLine(entry.term)}`];
	if (entry.guess && oneLine(entry.guess)) lines.push(`- guess:: ${oneLine(entry.guess)}`);
	lines.push(`- status:: ${oneLine(entry.status ?? 'to-look-up')}`);
	if (entry.category && oneLine(entry.category)) lines.push(`- category:: ${oneLine(entry.category)}`);
	if (entry.source && oneLine(entry.source)) lines.push(`- source:: ${oneLine(entry.source)}`);
	const block = `${lines.join('\n')}\n`;

	if (content.trim() === '') return `# Glossary\n\n${block}`;
	if (content.endsWith('\n\n')) return content + block;
	if (content.endsWith('\n')) return `${content}\n${block}`;
	return `${content}\n\n${block}`;
}

function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** Prose that cannot be mistaken for the grammar around it. */
function defuse(text: string): string {
	return text
		.replace(/\r/g, '')
		.trim()
		.split('\n')
		.map((line) => line.replace(/^#+[ \t]*/, '').replace(/^([ \t]*)→/, '$1->').replace(FIELD_LINE, (m) => m.replace('::', ':')))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');
}

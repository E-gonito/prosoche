/**
 * Parsing and span-rewriting `Private/Dating/Ledger.md`, one line per day:
 *
 *     - 2026-09-29 sent:: 12 matches:: 2 type:: 1 received:: 5 notes:: slow Monday
 *
 * A bullet, a date, then Dataview-style inline fields. `notes` is always
 * last and is free text, which is why the scan in `inline-fields.ts` stops
 * looking for markers once it finds one — a note reading "asked about
 * work::life balance" must not be split into a field called `life`.
 *
 * The two rules that matter for this file, same as `parse/task.ts`:
 *
 *  - A rewrite touches only the value it changed, through a character span,
 *    so odd spacing and a field this parser does not model survive untouched.
 *  - Nothing here reorders or deletes a line that is not the one being saved.
 */

import type { DayKey } from '../daily';
import { scanInlineFields } from './inline-fields';

export interface LedgerCounts {
	sent: number;
	matches: number;
	type: number;
	received: number;
}

export interface LedgerLine extends LedgerCounts {
	/** 0-based line index within the file. */
	line: number;
	day: DayKey;
	notes: string;
	raw: string;
}

export const ZERO_COUNTS: LedgerCounts = { sent: 0, matches: 0, type: 0, received: 0 };

const BULLET = /^([ \t]*[-*+][ \t]+)(\d{4}-\d{2}-\d{2})(?=[ \t]|$)/;
const KEYS = ['sent', 'matches', 'type', 'received', 'notes'] as const;
type Key = (typeof KEYS)[number];

/**
 * Parse one line. Returns null for anything that is not `- YYYY-MM-DD …`,
 * which includes the `# Ledger` heading, blank lines and prose — all kept
 * exactly as written by every function below, because they are simply never
 * matched against.
 */
export function parseLedgerLine(raw: string, line = 0): LedgerLine | null {
	const m = BULLET.exec(raw);
	if (!m) return null;

	const prefixEnd = m[0].length;
	const rest = raw.slice(prefixEnd);
	const fields = scanInlineFields(rest, KEYS, 'notes');
	const field = (key: Key) => fields.find((f) => f.key === key);

	const num = (key: Key): number => {
		const f = field(key);
		if (!f) return 0;
		const n = Number.parseInt(rest.slice(f.valueStart, f.valueEnd), 10);
		return Number.isFinite(n) ? n : 0;
	};

	const notesField = field('notes');
	const notes = notesField ? rest.slice(notesField.valueStart, notesField.valueEnd) : '';

	return {
		line,
		day: m[2],
		sent: num('sent'),
		matches: num('matches'),
		type: num('type'),
		received: num('received'),
		notes,
		raw
	};
}

/** Every ledger line in the file, in file order. Everything else is skipped, not reported. */
export function scanLedger(content: string): LedgerLine[] {
	const out: LedgerLine[] = [];
	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const parsed = parseLedgerLine(lines[i], i);
		if (parsed) out.push(parsed);
	}
	return out;
}

export interface LedgerEdit extends Partial<LedgerCounts> {
	notes?: string;
}

/**
 * Apply an edit to one ledger line and return the new line. Fields absent
 * from `edit` are left alone; a count field missing from the line is
 * appended rather than invented from nothing. `notes` is always kept last,
 * so a value set on a line that had none is inserted immediately before the
 * existing `notes::` marker, or at the end when there is none.
 *
 * Every change is a character-range replacement of the value alone: the
 * spacing either side, and anything this parser does not model, survive
 * exactly as written.
 */
export function rewriteLedgerLine(raw: string, edit: LedgerEdit): string {
	const m = BULLET.exec(raw);
	if (!m) return raw;

	const prefixEnd = m[0].length;
	const rest = raw.slice(prefixEnd);
	const fields = scanInlineFields(rest, KEYS, 'notes');
	const field = (key: Key) => fields.find((f) => f.key === key);
	const notesField = field('notes');

	const patches: Array<{ start: number; end: number; text: string }> = [];
	const missing: string[] = [];

	for (const key of ['sent', 'matches', 'type', 'received'] as const) {
		const value = edit[key];
		if (value === undefined) continue;
		const f = field(key);
		if (f) patches.push({ start: prefixEnd + f.valueStart, end: prefixEnd + f.valueEnd, text: String(value) });
		else missing.push(`${key}:: ${value}`);
	}

	if (edit.notes !== undefined) {
		const text = edit.notes.replace(/\s+/g, ' ').trim();
		if (notesField) {
			patches.push({ start: prefixEnd + notesField.valueStart, end: prefixEnd + notesField.valueEnd, text });
		} else if (text) {
			missing.push(`notes:: ${text}`);
		}
	}

	if (missing.length) {
		const insertAt = prefixEnd + (notesField ? notesField.keyStart : rest.length);
		const text = notesField ? `${missing.join(' ')} ` : ` ${missing.join(' ')}`;
		patches.push({ start: insertAt, end: insertAt, text });
	}

	let out = raw;
	for (const p of patches.sort((a, b) => b.start - a.start)) {
		out = out.slice(0, p.start) + p.text + out.slice(p.end);
	}
	return out;
}

/** A fresh line for a day with nothing logged yet. `notes` is omitted when empty. */
export function newLedgerLine(day: DayKey, counts: LedgerCounts, notes = ''): string {
	const parts = [
		`- ${day}`,
		`sent:: ${counts.sent}`,
		`matches:: ${counts.matches}`,
		`type:: ${counts.type}`,
		`received:: ${counts.received}`
	];
	const text = notes.replace(/\s+/g, ' ').trim();
	if (text) parts.push(`notes:: ${text}`);
	return parts.join(' ');
}

/**
 * Save one day into the ledger's whole content, keeping the file in date
 * order.
 *
 * A day that already has a line gets it rewritten in place, through
 * `rewriteLedgerLine`, so every other byte of the file is untouched. A day
 * with none gets a fresh line inserted immediately after the last earlier
 * day (or before the first later one), never at a fixed end-of-file
 * position, so the file stays sorted however many days are skipped. A
 * genuinely empty file gets a `# Ledger` heading; a file with content but no
 * ledger lines yet — not expected in practice — gets the line appended
 * after what is there.
 */
export function saveLedgerDay(content: string, day: DayKey, counts: LedgerCounts, notes = ''): string {
	const lines = content.split('\n');
	const entries: Array<{ line: number; day: DayKey }> = [];
	for (let i = 0; i < lines.length; i++) {
		const parsed = parseLedgerLine(lines[i], i);
		if (parsed) entries.push({ line: i, day: parsed.day });
	}

	const existing = entries.find((e) => e.day === day);
	if (existing) {
		lines[existing.line] = rewriteLedgerLine(lines[existing.line], { ...counts, notes });
		return lines.join('\n');
	}

	const newLine = newLedgerLine(day, counts, notes);

	if (entries.length === 0) {
		const trimmed = content.replace(/\s+$/, '');
		if (trimmed === '') return `# Ledger\n\n${newLine}\n`;
		return `${trimmed}\n${newLine}\n`;
	}

	let insertAt = entries[0].line;
	for (const e of entries) {
		if (e.day < day) insertAt = e.line + 1;
	}
	lines.splice(insertAt, 0, newLine);
	return lines.join('\n');
}

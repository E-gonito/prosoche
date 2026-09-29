/**
 * The grammar of a CRM contact: one note per supplier, stakeholder or lead,
 * filed as `<home>/CRM/<Name>.md` so `[[Mang Tomas Foods]]` in Obsidian links
 * straight to it.
 *
 *     ---
 *     kind: supplier
 *     company: Mang Tomas Foods
 *     role: Sales
 *     email: orders@mangtomas.ph
 *     phone: +44 7700 900123
 *     links:
 *       - https://mangtomas.ph
 *     ---
 *
 *     Pork and chicken supplier. Met at the trade fair.
 *
 *     ## History
 *     - 2026-09-29 Asked for a wholesale price list
 *     - 2026-09-22 First call
 *
 * The name is the file name and nothing else; the frontmatter holds the
 * details; the body is free notes; `## History` is one dated bullet per
 * interaction, newest first. Everything here is pure. Writes are span edits:
 * a detail rewrites its own frontmatter lines through `frontmatter.ts`, and a
 * history entry is one inserted line. Neither re-serialises the note.
 */

import type { DayKey } from '../daily';
import { appendUnderHeading } from '../sections';
import { setFrontmatterField } from './frontmatter';
import { parseNote } from './note';

/** The kinds the new-contact form offers. Any other `kind:` is still read and shown as written. */
export const CONTACT_KINDS = ['supplier', 'stakeholder', 'lead'] as const;

/** Every frontmatter field a contact has, in the order a new contact's file lists them. */
export const CONTACT_FIELDS = ['kind', 'company', 'role', 'email', 'phone', 'links'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

export const HISTORY_HEADING = '## History';

/** The details in a contact's frontmatter. A field that is absent or empty reads as null, or `[]` for links. */
export interface ContactDetails {
	kind: string | null;
	company: string | null;
	role: string | null;
	email: string | null;
	phone: string | null;
	links: string[];
}

/** One bullet under `## History`. */
export interface HistoryEntry {
	/** 0-based line index within the whole file. */
	line: number;
	/** The date the bullet starts with, or null for a bullet written without one. */
	day: DayKey | null;
	text: string;
}

export interface ParsedContact extends ContactDetails {
	/** The body with the frontmatter and the `## History` section taken out, for rendering. */
	notes: string;
	/** History bullets in file order. */
	history: HistoryEntry[];
}

/** What a new contact may be created with. Every part is optional but the name, which is the file's. */
export type ContactInput = Partial<Record<Exclude<ContactField, 'links'>, string>> & { links?: string[]; notes?: string };

/** Characters that cannot be in a file name on some system the vault syncs to, or that break a wikilink. */
const UNSAFE = /[\\/:*?"<>|#^[\]\u0000-\u001f]/;
const MAX_NAME = 120;

/**
 * A contact's name as its file name, or null when it cannot be one.
 *
 * Whitespace collapses and a trailing `.md` is dropped. Anything else that
 * would change the name — a slash, a colon, a `#` or brackets that break
 * `[[links]]`, a leading or trailing dot, an empty or overlong name — is a
 * refusal rather than a silent rewrite, because the name is what every link
 * to the contact spells.
 */
export function contactName(raw: string): string | null {
	const name = raw.replace(/\s+/g, ' ').trim().replace(/\.md$/i, '').trim();
	if (!name || name.length > MAX_NAME || UNSAFE.test(name) || name.startsWith('.') || name.endsWith('.')) return null;
	return name;
}

/**
 * Read a contact's note. Never throws: malformed frontmatter reads as no
 * details, and a note with no `## History` has an empty history and all of
 * its body as notes.
 */
export function parseContact(content: string): ParsedContact {
	const parsed = parseNote(content);
	const fm = parsed.frontmatter;
	const lines = content.split('\n');
	const section = historySection(lines, parsed.bodyOffset);

	const history: HistoryEntry[] = [];
	if (section) {
		for (let i = section.start + 1; i < section.end; i++) {
			const bullet = BULLET.exec(lines[i]);
			if (!bullet) continue;
			const dated = DATED.exec(bullet[1]);
			history.push(dated ? { line: i, day: dated[1], text: (dated[2] ?? '').trim() } : { line: i, day: null, text: bullet[1].trim() });
		}
	}

	const bodyLines = lines.slice(parsed.bodyOffset);
	const notes = section
		? [...bodyLines.slice(0, section.start - parsed.bodyOffset), ...bodyLines.slice(section.end - parsed.bodyOffset)].join('\n')
		: bodyLines.join('\n');

	return {
		kind: text(fm.kind),
		company: text(fm.company),
		role: text(fm.role),
		email: text(fm.email),
		phone: text(fm.phone),
		links: list(fm.links),
		notes: notes.trim(),
		history
	};
}

/**
 * The whole text of a new contact's note: every field in `CONTACT_FIELDS`
 * order, empty ones as a bare `key:` so a later edit replaces rather than
 * inserts, then the notes, then an empty `## History`. Values are written the
 * same way an edit writes them.
 */
export function newContact(input: ContactInput): string {
	const skeleton = ['---', ...CONTACT_FIELDS.map((f) => `${f}:`), '---', ''].join('\n');
	let content = skeleton;
	for (const field of CONTACT_FIELDS) {
		const value = input[field];
		if (value !== undefined) content = setContactField(content, field, value);
	}
	const notes = (input.notes ?? '').trim();
	return `${content}\n${notes ? `${notes}\n\n` : ''}${HISTORY_HEADING}\n`;
}

/**
 * Set or clear one of a contact's fields, changing only that field's lines.
 *
 * `links` is a list: given one string, it is split on whitespace, since a
 * link has none. Every other field is one line of text: given a list, its
 * items are joined with commas. An empty value clears the field and keeps
 * the key. A missing key is inserted. Pure; see `setFrontmatterField` for
 * exactly which bytes change.
 */
export function setContactField(content: string, field: ContactField, value: string | readonly string[]): string {
	if (field === 'links') {
		const links = typeof value === 'string' ? value.split(/\s+/) : value;
		return setFrontmatterField(content, field, [...new Set(links.map((l) => l.trim()).filter(Boolean))]);
	}
	return setFrontmatterField(content, field, typeof value === 'string' ? value : value.join(', '));
}

/**
 * Insert `- <day> <text>` under `## History`, creating the heading at the end
 * of the note when it has none. Returns null when `text` has no words.
 *
 * History is kept newest first, so the entry goes ahead of the first dated
 * bullet no newer than it: on top for today's entry, in date order for a
 * back-dated one, and last when everything already there is newer. Every
 * existing line keeps its bytes; only the one new line is added.
 */
export function addHistoryEntry(content: string, day: DayKey, text: string): { content: string; line: number } | null {
	const words = text.replace(/\s+/g, ' ').trim();
	if (!words) return null;
	return appendUnderHeading(content, HISTORY_HEADING, `- ${day} ${words}`, (line) => {
		const dated = DATED.exec(BULLET.exec(line)?.[1] ?? '');
		return dated !== null && dated[1] <= day;
	});
}

const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/;
const DATED = /^(\d{4}-\d{2}-\d{2})(?:[ \t]+(.*))?$/;
const HEADING = /^#{1,6}[ \t]/;
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Where `## History` starts and the line its section ends before, found the
 * way `appendUnderHeading` finds it — outside code fences, case-insensitive
 * — so what is read is exactly where an entry would be written.
 */
function historySection(lines: string[], from: number): { start: number; end: number } | null {
	let fence: string | null = null;
	for (let i = from; i < lines.length; i++) {
		const f = FENCE.exec(lines[i]);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null || lines[i].trim().toLowerCase() !== HISTORY_HEADING.toLowerCase()) continue;
		let end = i + 1;
		while (end < lines.length && !HEADING.test(lines[end])) end++;
		return { start: i, end };
	}
	return null;
}

/** A frontmatter scalar as text. YAML reads a bare date as a Date and a bare number as a number; both mean what was typed. */
function text(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function list(value: unknown): string[] {
	const items = Array.isArray(value) ? value : [value];
	return items.map(text).filter((v): v is string => v !== null);
}

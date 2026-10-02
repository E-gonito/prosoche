/**
 * A like sent, as frontmatter on a dating person's note: the one place that
 * knows how the record's fields are spelled in the vault.
 *
 *     ---
 *     type: person
 *     stage: liked
 *     liked: 2026-10-01          sentDate
 *     chance: 10                 forecast, whole percent, 2–98
 *     status: pending            pending | yes | no
 *     resolved: 2026-10-09       resolvedDate
 *     resolved_by: auto          manual | auto
 *     out_of_league: true        outOfLeague
 *     fits_type: false           fitsType
 *     age: 27
 *     liked_on: prompt           photo | prompt
 *     commented: true
 *     liked_migrated: true       only when the migration supplied `liked:`
 *     ---
 *
 * `liked:` and `chance:` are the names the app already wrote before the
 * record grew, so existing notes need no renaming. A field that is missing,
 * blank or unreadable is unknown (`null`), never false; clearing a field
 * leaves its key with no value.
 *
 * A note is a like when it has a `chance:`: a forecast is what makes it a
 * record. A person added by hand has none and is not one.
 *
 * Everything here is pure. Every edit is a span edit of one frontmatter line
 * through `setFrontmatterField`, so nothing else in the note changes.
 */

import { addDays } from '$lib/shared/time';
import {
	clampForecast,
	LIKE_STATUSES,
	LIKED_ON,
	type Like,
	type LikeFields,
	type LikedOn,
	type LikeStatus
} from '$lib/shared/likes';
import { setFrontmatterField } from './frontmatter';
import { basename, parseNote } from './note';

/** Each field of the record, and the frontmatter key it is kept under. */
const KEYS = {
	sentDate: 'liked',
	forecast: 'chance',
	status: 'status',
	resolvedDate: 'resolved',
	resolvedBy: 'resolved_by',
	outOfLeague: 'out_of_league',
	fitsType: 'fits_type',
	age: 'age',
	likedOn: 'liked_on',
	commented: 'commented',
	sentDateMigrated: 'liked_migrated'
} as const;

/** The stages that mean she has replied, which is the outcome's yes. */
const REPLIED_STAGES = ['talking', 'date planned', 'dating'];

/** What one edit may set. `null` clears a field back to unknown. */
export type LikeChange = Partial<LikeFields> & {
	status?: LikeStatus;
	resolvedDate?: string | null;
	resolvedBy?: 'manual' | 'auto' | null;
	/** `null` clears the mark, once the day has been set by hand. */
	sentDateMigrated?: boolean | null;
};

/** True for a note that is a like record: it carries a forecast. Pure. */
export function isLike(content: string): boolean {
	return asNumber(parseNote(content).frontmatter[KEYS.forecast]) !== null;
}

/**
 * The like a note holds, or null when it is not one (see `isLike`).
 *
 * `path` gives the label. The forecast is read clamped, so a note still
 * holding a 0 scores as 2 before the migration has written it. A note with
 * no `liked:` day reads as sent on `fallbackDay` and `sentDateMigrated`.
 * Never throws: a field it cannot read is null.
 */
export function readLike(path: string, content: string, hash: string, fallbackDay: string): Like | null {
	const { frontmatter: fm, body } = parseNote(content, path);
	const chance = asNumber(fm[KEYS.forecast]);
	if (chance === null) return null;
	const sent = asDay(fm[KEYS.sentDate]);
	const label = basename(path);
	return {
		id: label,
		label,
		sentDate: sent ?? fallbackDay,
		forecast: clampForecast(chance),
		outOfLeague: asBool(fm[KEYS.outOfLeague]),
		fitsType: asBool(fm[KEYS.fitsType]),
		age: asAge(fm[KEYS.age]),
		likedOn: asOneOf(fm[KEYS.likedOn], LIKED_ON),
		commented: asBool(fm[KEYS.commented]),
		status: asOneOf(fm[KEYS.status], LIKE_STATUSES) ?? 'pending',
		resolvedDate: asDay(fm[KEYS.resolvedDate]),
		resolvedBy: asOneOf(fm[KEYS.resolvedBy], ['manual', 'auto'] as const),
		notes: notesOf(body, label),
		sentDateMigrated: sent === null || asBool(fm[KEYS.sentDateMigrated]) === true,
		hash
	};
}

/**
 * `content` with `change` applied, one frontmatter line per field, in
 * `KEYS` order. A forecast is clamped; `null` clears a field; a field left
 * out of `change` is untouched. A change that sets nothing returns `content`
 * as it was. Pure.
 */
export function editLike(content: string, change: LikeChange): string {
	let out = content;
	for (const [field, key] of Object.entries(KEYS) as Array<[keyof typeof KEYS, string]>) {
		if (!(field in change)) continue;
		const value = change[field];
		if (value === undefined) continue;
		const text = value === null ? '' : field === 'forecast' ? clampForecast(value as number) : (value as string | number | boolean);
		out = setFrontmatterField(out, key, text);
	}
	return out;
}

/**
 * The edit that brings a like's note in line with the rules, or `{}` when
 * it already is. Pure; the caller writes it.
 *
 * - A forecast outside 2–98, or not a whole number, is clamped (0 becomes 2).
 * - A note with no `status:` is given one: `yes` when her stage already says
 *   she replied (talking, date planned, dating), otherwise `pending`.
 * - A note with no `liked:` day is given `fallbackDay` and marked migrated.
 * - A pending like with `sentDate + days < today` becomes `no`, resolved by
 *   `auto` on the first day the rule applied, `sentDate + days + 1`.
 *
 * Never changes a like that is already yes or no, and never deletes a field.
 * Not a like (no forecast) means no edit.
 */
export function settleLike(content: string, opts: { today: string; fallbackDay: string; days: number }): LikeChange {
	const { frontmatter: fm } = parseNote(content);
	const chance = asNumber(fm[KEYS.forecast]);
	if (chance === null) return {};
	const change: LikeChange = {};

	if (clampForecast(chance) !== chance) change.forecast = clampForecast(chance);

	let sent = asDay(fm[KEYS.sentDate]);
	if (sent === null) {
		sent = opts.fallbackDay;
		change.sentDate = sent;
		change.sentDateMigrated = true;
	}

	let status = asOneOf(fm[KEYS.status], LIKE_STATUSES);
	if (status === null) {
		status = REPLIED_STAGES.includes(String(fm.stage ?? '')) ? 'yes' : 'pending';
		change.status = status;
		if (status === 'yes') Object.assign(change, { resolvedDate: opts.today, resolvedBy: 'manual' });
	}

	const lapsed = addDays(sent, opts.days + 1);
	if (status === 'pending' && lapsed <= opts.today) Object.assign(change, { status: 'no', resolvedDate: lapsed, resolvedBy: 'auto' });
	return change;
}

/** Whether a stage means she replied, which resolves a pending like to yes. Pure. */
export function stageMeansReply(stage: string): boolean {
	return REPLIED_STAGES.includes(stage);
}

/** The note's own words: the body without its `# Title` line or the `## Dates` log. */
function notesOf(body: string, title: string): string {
	const lines = body.split('\n');
	const dates = lines.findIndex((l) => l.trim().toLowerCase() === '## dates');
	const prose = dates === -1 ? lines : lines.slice(0, dates);
	const head = prose.findIndex((l) => l.trim() !== '');
	if (head !== -1 && prose[head].trim() === `# ${title}`) prose.splice(head, 1);
	return prose.join('\n').trim();
}

function asNumber(value: unknown): number | null {
	if (value === undefined || value === null || value === '' || typeof value === 'boolean') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function asAge(value: unknown): number | null {
	const n = asNumber(value);
	return n !== null && Number.isInteger(n) && n > 0 && n < 130 ? n : null;
}

function asBool(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value !== 'string') return null;
	const v = value.trim().toLowerCase();
	return v === 'true' || v === 'yes' ? true : v === 'false' || v === 'no' ? false : null;
}

/** YAML turns a bare date into a Date; both spellings mean the same day. */
function asDay(value: unknown): string | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value.trim()) ? (value.trim() as T) : null;
}

/** Whether an untrusted value is one of the places a like can be sent from. Pure. */
export function isLikedOn(value: unknown): value is LikedOn {
	return typeof value === 'string' && (LIKED_ON as readonly string[]).includes(value);
}

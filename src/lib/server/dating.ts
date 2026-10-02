/**
 * The Dating module's one door to the vault.
 *
 * Everything the Dating module reads or writes lives under `Private/Dating/`,
 * and this is the only file in the codebase that passes `{ scope: 'private' }`
 * for one of those paths — a public read or list of the same paths sees
 * nothing at all, which is what `dating.test.ts` proves. Nowhere else names
 * `Private/Dating` or reaches for the Vault with private scope; a route
 * handler, the Insights prompt builder and every component talk to this
 * module and nothing underneath it.
 *
 *     Private/Dating/Ledger.md          one line per day, `parse/ledger.ts`
 *     Private/Dating/People/<Name>.md   the shared person format, `parse/dating-person.ts`
 *     Private/Dating/Type.md            the user's own note on their type, read and saved whole
 *
 * A person enters at `stage: liked` when the user logs a like they sent.
 * The like is a record in her note's frontmatter (`parse/like.ts`): the day,
 * a forecast that she replies after matching, tags, and whether she did.
 * `loadLikes` brings every record in line with the rules before reading it
 * (the migration, and auto-resolving a like left pending too long), and
 * `like-stats.ts` scores the forecasts.
 *
 * The stats functions are pure — they take entries already read, not a vault
 * — so they can be table-tested without touching the filesystem at all.
 */

import { isDayKey, shiftDay, today, type DayKey } from './daily';
import { AUTO_RESOLVE_DAYS, clampForecast, LIKE_STATUSES, OUTCOME, type Like, type LikeFields, type LikeStatus } from '$lib/shared/likes';
import { editLike, isLike, isLikedOn, readLike, settleLike, stageMeansReply, type LikeChange } from './parse/like';
import { renderMarkdown } from './render';
import { newDateLine, scanDates, type DateEntry } from './parse/dating-person';
import { setFrontmatterField } from './parse/frontmatter';
import { newLedgerLine, saveLedgerDay, scanLedger, ZERO_COUNTS, type LedgerCounts, type LedgerLine } from './parse/ledger';
import { basename, parseNote } from './parse/note';
import { personName } from './people';
import { appendUnderHeading } from './sections';
import { hashContent, type Vault } from './vault/index';
import { daysBetween } from '$lib/shared/time';

const DATING_FOLDER = 'Private/Dating';
export const LEDGER_PATH = `${DATING_FOLDER}/Ledger.md`;
export const PEOPLE_FOLDER = `${DATING_FOLDER}/People`;
export const TYPE_NOTE_PATH = `${DATING_FOLDER}/Type.md`;
const DATES_HEADING = '## Dates';

export const STAGES = ['liked', 'matched', 'talking', 'date planned', 'dating', 'ended'] as const;
export type Stage = (typeof STAGES)[number];
/** The stage a person added by hand starts at: they have matched, since a like sent is logged separately. */
export const DEFAULT_STAGE: Stage = 'matched';

function asStage(value: unknown): Stage | null {
	return typeof value === 'string' && (STAGES as readonly string[]).includes(value) ? (value as Stage) : null;
}

function text(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	return String(value);
}

/** YAML turns a bare date into a Date; both spellings mean the same day. */
function asDay(value: unknown): DayKey | null {
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** A `chance:` value as a whole percentage, 0–100, or null for anything else. */
function asChance(value: unknown): number | null {
	if (value === undefined || value === null || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
}

/* ------------------------------------------------------------------ Log --- */

interface DayEntry extends LedgerCounts {
	day: DayKey;
	notes: string;
	/** Content hash of the whole ledger, for conflict detection on save. */
	hash: string;
}

/** Every day in the ledger, plus the file's hash for a save that follows. */
export async function loadLedger(vault: Vault): Promise<{ entries: LedgerLine[]; hash: string }> {
	const note = await vault.read(LEDGER_PATH, { scope: 'private' });
	return { entries: scanLedger(note.content), hash: note.exists ? note.hash : hashContent('') };
}

/** One day's counters and notes. A day with no line reads as all zero, not missing. */
export async function loadDay(vault: Vault, day: DayKey): Promise<DayEntry> {
	const { entries, hash } = await loadLedger(vault);
	const found = entries.find((e) => e.day === day);
	return found
		? { day, sent: found.sent, matches: found.matches, type: found.type, received: found.received, notes: found.notes, hash }
		: { day, ...ZERO_COUNTS, notes: '', hash };
}

type SaveDayResult = { ok: true; hash: string } | { ok: false; reason: 'conflict' };

/**
 * Save one day's counters and notes.
 *
 * `expectedHash` is the hash the caller last loaded — `loadDay`'s own `hash`
 * field when the ledger existed, or the sentinel `hashContent('')` when it
 * did not — the same "believed missing" convention `people.logContact` uses.
 * A ledger that changed underneath, on another device or from Obsidian,
 * comes back as a conflict rather than being overwritten.
 */
export async function saveDay(
	vault: Vault,
	day: DayKey,
	counts: LedgerCounts,
	notes: string,
	expectedHash: string
): Promise<SaveDayResult> {
	const note = await vault.read(LEDGER_PATH, { scope: 'private' });
	if (note.exists ? note.hash !== expectedHash : hashContent('') !== expectedHash) {
		return { ok: false, reason: 'conflict' };
	}
	const next = saveLedgerDay(note.content, day, counts, notes);
	const result = await vault.write(LEDGER_PATH, next, expectedHash, { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, hash: result.note.hash };
}

/* --------------------------------------------------------------- Stats --- */

interface RangeStats {
	/** Calendar days the range covers: 7, 30, or the span since the first logged day. */
	days: number;
	totals: LedgerCounts;
	/** matches / sent. Null when nothing was sent, rather than zero. */
	matchRate: number | null;
	/** type / matches. Null when there were no matches. */
	typeRate: number | null;
	receivedPerDay: number | null;
}

type RangeKind = '7d' | '30d' | 'all';

/**
 * Totals and rates over a range ending on `asOf` (today, by default).
 *
 * "Matches" here means matches from the user's own likes, per the artifact's
 * own caution: liking back an incoming like is not counted as a match of a
 * like sent, or the match rate would read higher than it is. The ledger
 * already keeps that distinction — `matches::` is defined at the point of
 * entry as "from your likes, whenever they arrived" — so this function only
 * has to divide the numbers as given, not re-derive the distinction.
 */
export function rangeStats(entries: LedgerLine[], range: RangeKind, asOf: DayKey = today()): RangeStats {
	const cutoff = range === '7d' ? shiftDay(asOf, -6) : range === '30d' ? shiftDay(asOf, -29) : null;
	const inRange = entries.filter((e) => e.day <= asOf && (cutoff === null || e.day >= cutoff));

	const totals = inRange.reduce<LedgerCounts>(
		(acc, e) => ({
			sent: acc.sent + e.sent,
			matches: acc.matches + e.matches,
			type: acc.type + e.type,
			received: acc.received + e.received
		}),
		{ ...ZERO_COUNTS }
	);

	const days =
		cutoff !== null ? (range === '7d' ? 7 : 30) : inRange.length ? daysBetween(inRange[0].day, asOf) + 1 : 0;

	return {
		days,
		totals,
		matchRate: totals.sent > 0 ? totals.matches / totals.sent : null,
		typeRate: totals.matches > 0 ? totals.type / totals.matches : null,
		receivedPerDay: days > 0 ? totals.received / days : null
	};
}

interface WeekPoint {
	/** The Monday-to-Sunday-style week's first day, as the range ends on `asOf`. */
	weekStart: DayKey;
	weekEnd: DayKey;
	sent: number;
	matches: number;
	received: number;
}

/** Totals per trailing 7-day block, oldest first, for a trend chart. */
export function weeklyTrend(entries: LedgerLine[], weeks = 12, asOf: DayKey = today()): WeekPoint[] {
	const points: WeekPoint[] = [];
	for (let w = weeks - 1; w >= 0; w--) {
		const weekEnd = shiftDay(asOf, -w * 7);
		const weekStart = shiftDay(weekEnd, -6);
		const inWeek = entries.filter((e) => e.day >= weekStart && e.day <= weekEnd);
		points.push({
			weekStart,
			weekEnd,
			sent: inWeek.reduce((n, e) => n + e.sent, 0),
			matches: inWeek.reduce((n, e) => n + e.matches, 0),
			received: inWeek.reduce((n, e) => n + e.received, 0)
		});
	}
	return points;
}

interface WeekdayStat {
	weekday: string;
	matches: number;
}

/** The day of the week with the most matches, or null when nothing is logged. */
export function bestDayOfWeek(entries: LedgerLine[]): WeekdayStat | null {
	const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const totals = new Array(7).fill(0) as number[];
	for (const e of entries) {
		const [y, m, d] = e.day.split('-').map(Number);
		totals[new Date(y, m - 1, d).getDay()] += e.matches;
	}
	let best = 0;
	for (let i = 1; i < 7; i++) if (totals[i] > totals[best]) best = i;
	return totals[best] > 0 ? { weekday: names[best], matches: totals[best] } : null;
}

/* -------------------------------------------------------------- People --- */

interface DatingPersonSummary {
	name: string;
	path: string;
	app: string | null;
	age: string | null;
	place: string | null;
	job: string | null;
	stage: Stage | null;
	/** The day the user logged sending her a like, when they did. */
	liked: DayKey | null;
	/** The user's guess, 0–100, that she replies to that like. */
	chance: number | null;
}

function personPath(name: string): string {
	return `${PEOPLE_FOLDER}/${personName(name)}.md`;
}

function summaryFrom(path: string, frontmatter: Record<string, unknown>): DatingPersonSummary {
	return {
		name: basename(path),
		path,
		app: text(frontmatter.app),
		age: text(frontmatter.age),
		place: text(frontmatter.place),
		job: text(frontmatter.job),
		stage: asStage(frontmatter.stage),
		liked: asDay(frontmatter.liked),
		chance: asChance(frontmatter.chance)
	};
}

/** Every dating person, in the shared person format, grouped by stage by the caller. */
export async function listDatingPeople(vault: Vault): Promise<DatingPersonSummary[]> {
	const paths = (await vault.list({ scope: 'private' })).filter((p) => p.startsWith(`${PEOPLE_FOLDER}/`));
	const out: DatingPersonSummary[] = [];
	for (const path of paths) {
		const note = await vault.read(path, { scope: 'private' });
		out.push(summaryFrom(path, parseNote(note.content, path).frontmatter));
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface DatingPerson extends DatingPersonSummary {
	exists: boolean;
	/** Free-text notes only: the body with frontmatter removed and the `## Dates` section cut off. */
	body: string;
	dates: DateEntry[];
	hash: string;
}

/** One dating person, whether or not they have a note yet. */
export async function loadDatingPerson(vault: Vault, rawName: string): Promise<DatingPerson> {
	const path = personPath(rawName);
	const note = await vault.read(path, { scope: 'private' });
	const parsed = parseNote(note.content, path);
	return {
		...summaryFrom(path, parsed.frontmatter),
		exists: note.exists,
		body: proseOnly(parsed.body),
		dates: scanDates(note.content),
		hash: note.exists ? note.hash : hashContent('')
	};
}

/**
 * The free-text part of a person's note: everything before `## Dates`, which
 * is shown separately as the structured log. A note with no such heading
 * reads as entirely prose.
 */
function proseOnly(body: string): string {
	const at = body.split('\n').findIndex((line) => line.trim().toLowerCase() === DATES_HEADING.toLowerCase());
	return at === -1 ? body : body.split('\n').slice(0, at).join('\n');
}

type AddPersonResult = { ok: true; path: string } | { ok: false; reason: 'no-name' | 'exists' };

type NewPersonFields = {
	app?: string;
	age?: string;
	place?: string;
	job?: string;
	stage?: Stage;
	notes?: string;
	/** The day a like was sent; written as `liked:` only when given. */
	liked?: DayKey;
	/** The guess, 0–100, that she replies; rounded and clamped, written as `chance:` only when given. */
	chance?: number;
};

/**
 * Create a new dating person's note. Refuses rather than overwrites one that
 * already exists. Logging a like sent is this with `stage: 'liked'`, `liked`
 * and `chance`; a person added with none of those gets no such lines.
 */
export async function addDatingPerson(vault: Vault, fields: { name: string } & NewPersonFields): Promise<AddPersonResult> {
	const name = personName(fields.name);
	if (!name) return { ok: false, reason: 'no-name' };
	const path = personPath(name);
	const note = await vault.read(path, { scope: 'private' });
	if (note.exists) return { ok: false, reason: 'exists' };

	const result = await vault.write(path, newPersonNote(name, fields), hashContent(''), { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, path };
}

type AddDateResult = { ok: true; line: number } | { ok: false; reason: 'no-name' | 'no-text' | 'conflict' };

/** Append one line to a person's `## Dates` log, creating their note when they have none. */
export async function addDatingDate(
	vault: Vault,
	rawName: string,
	entry: { day?: DayKey; text: string; rating?: number | null; cost?: number | null; notes?: string }
): Promise<AddDateResult> {
	const name = personName(rawName);
	if (!name) return { ok: false, reason: 'no-name' };
	if (!entry.text.trim()) return { ok: false, reason: 'no-text' };

	const path = personPath(name);
	const note = await vault.read(path, { scope: 'private' });
	const base = note.exists ? note.content : newPersonNote(name, {});
	const line = newDateLine(entry.day ?? today(), entry.text, entry);
	const next = appendUnderHeading(base, DATES_HEADING, line);

	const result = await vault.write(path, next.content, note.exists ? note.hash : hashContent(''), { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, line: next.line };
}

type SetStageResult = { ok: true } | { ok: false; reason: 'no-note' | 'conflict' };

/**
 * Rewrite a person's frontmatter `stage:` line. When the new stage means she
 * replied (talking, date planned, dating) and her like is still pending, the
 * like resolves to yes by hand today in the same write, so the outcome and
 * the stage never disagree. Nothing else in the note changes.
 */
export async function setStage(vault: Vault, rawName: string, stage: Stage, day: DayKey = today()): Promise<SetStageResult> {
	const path = personPath(rawName);
	const note = await vault.read(path, { scope: 'private' });
	if (!note.exists) return { ok: false, reason: 'no-note' };

	let next = setFrontmatterField(note.content, 'stage', stage);
	const like = readLike(path, note.content, note.hash, day);
	if (like?.status === 'pending' && stageMeansReply(stage)) next = editLike(next, resolution('yes', day));
	const result = await vault.write(path, next, note.hash, { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true };
}

function newPersonNote(name: string, fields: NewPersonFields): string {
	const chance = asChance(fields.chance);
	const frontmatter = [
		'---',
		'type: person',
		`app: ${fields.app ?? ''}`,
		`age: ${fields.age ?? ''}`,
		`place: ${fields.place ?? ''}`,
		`job: ${fields.job ?? ''}`,
		`stage: ${fields.stage ?? DEFAULT_STAGE}`,
		...(fields.liked ? [`liked: ${fields.liked}`] : []),
		...(chance !== null ? [`chance: ${chance}`] : []),
		'---'
	].join('\n');
	const notes = (fields.notes ?? '').trim();
	return `${frontmatter}\n\n# ${name}\n${notes ? `\n${notes}\n` : ''}`;
}

/* --------------------------------------------------------------- Likes --- */

/**
 * Every like sent, oldest first, each brought in line with the rules before
 * it is read (see `settleLike`): a forecast clamped to 2–98, a missing
 * status made pending, a missing day supplied from the note's last change
 * and marked migrated, and a like pending more than `AUTO_RESOLVE_DAYS`
 * after it was sent resolved to no by `auto`.
 *
 * Side effects: writes each note that needed one of those, as span edits of
 * its frontmatter lines and nothing else, guarded by the hash just read. A
 * note that changed in between is read as it is and settled next time.
 * Never deletes and never touches a note that is not a like.
 */
export async function loadLikes(vault: Vault, day: DayKey = today()): Promise<Like[]> {
	const paths = (await vault.list({ scope: 'private' })).filter((p) => p.startsWith(`${PEOPLE_FOLDER}/`));
	const likes: Like[] = [];
	for (const path of paths) {
		let note = await vault.read(path, { scope: 'private' });
		if (!note.exists || !isLike(note.content)) continue;
		const fallbackDay = today(new Date(note.mtimeMs));
		const change = settleLike(note.content, { today: day, fallbackDay, days: AUTO_RESOLVE_DAYS });
		if (Object.keys(change).length) {
			const written = await vault.write(path, editLike(note.content, change), note.hash, { scope: 'private' });
			if (written.ok) note = written.note;
		}
		const like = readLike(path, note.content, note.hash, fallbackDay);
		if (like) likes.push(like);
	}
	return likes.sort((a, b) => a.sentDate.localeCompare(b.sentDate) || a.label.localeCompare(b.label));
}

/** What the quick-add form sends. `null` and absent both mean unknown. */
export type NewLike = { label: string; sentDate?: string; forecast: number; notes?: string } & Partial<Omit<LikeFields, 'sentDate' | 'forecast'>>;

type LikeResult = { ok: true; like: Like } | { ok: false; reason: 'no-name' | 'exists' | 'bad-day' | 'invalid' | 'no-note' | 'not-found' | 'conflict' };

/**
 * Log a like sent: a new person note at `stage: liked` holding the record,
 * pending, sent on `sentDate` (today when absent), with the forecast clamped
 * to 2–98. Unknown tags are left out of the note. Refuses a label that
 * cannot be a file name (`no-name`), one that already has a note (`exists`,
 * never overwritten), a day that is not `YYYY-MM-DD` (`bad-day`) and a
 * forecast that is not a number (`invalid`).
 */
export async function addLike(vault: Vault, input: NewLike, day: DayKey = today()): Promise<LikeResult> {
	const name = personName(input.label ?? '');
	if (!name) return { ok: false, reason: 'no-name' };
	const sentDate = input.sentDate ?? day;
	if (!isDayKey(sentDate)) return { ok: false, reason: 'bad-day' };
	if (typeof input.forecast !== 'number' || !Number.isFinite(input.forecast)) return { ok: false, reason: 'invalid' };
	const checked = likeFields(input);
	if (!checked) return { ok: false, reason: 'invalid' };

	const path = personPath(name);
	if ((await vault.read(path, { scope: 'private' })).exists) return { ok: false, reason: 'exists' };
	const base = newPersonNote(name, { stage: 'liked', liked: sentDate, chance: input.forecast, notes: input.notes });
	// The day is already on its `liked:` line; only the rest is added to the new note.
	const { sentDate: _day, ...tags } = checked;
	const content = editLike(base, { ...tags, forecast: input.forecast, status: 'pending' });
	const result = await vault.write(path, content, hashContent(''), { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, like: readLike(path, result.note.content, result.note.hash, day)! };
}

/** One edit to a like: any of its fields, its status, or both. */
export interface LikeEdit {
	fields?: Partial<LikeFields>;
	status?: LikeStatus;
}

/**
 * Edit a like, if its note still has `expectedHash`.
 *
 * Fields are span edits of their own lines; a new `sentDate` clears the
 * migrated mark. Setting the status to yes or no resolves it by hand on
 * `day`; setting it back to pending clears the resolution, and a like old
 * enough is then resolved by `auto` again on the next `loadLikes`. Yes on a
 * person still at liked or matched moves her stage to talking, since a reply
 * is what talking means; no never touches the stage.
 *
 * Refusals: `no-note`, `not-found` for a note that is not a like,
 * `conflict` for a note changed since it was read, and `invalid` or
 * `bad-day` for a value that cannot be stored. A refusal writes nothing.
 */
export async function updateLike(vault: Vault, rawName: string, edit: LikeEdit, expectedHash: string, day: DayKey = today()): Promise<LikeResult> {
	const path = personPath(rawName);
	const note = await vault.read(path, { scope: 'private' });
	if (!note.exists) return { ok: false, reason: 'no-note' };
	if (note.hash !== expectedHash) return { ok: false, reason: 'conflict' };
	const current = readLike(path, note.content, note.hash, day);
	if (!current) return { ok: false, reason: 'not-found' };

	const fields = likeFields(edit.fields ?? {});
	if (!fields) return { ok: false, reason: 'invalid' };
	if (fields.sentDate !== undefined && !isDayKey(fields.sentDate)) return { ok: false, reason: 'bad-day' };
	if (edit.status !== undefined && !(LIKE_STATUSES as readonly string[]).includes(edit.status)) return { ok: false, reason: 'invalid' };

	const change: LikeChange = { ...fields };
	if (fields.sentDate !== undefined && current.sentDateMigrated) change.sentDateMigrated = null;
	if (edit.status !== undefined && edit.status !== current.status) Object.assign(change, resolution(edit.status, day));

	let next = editLike(note.content, change);
	const stage = asStage(parseNote(note.content).frontmatter.stage);
	if (change.status === 'yes' && (stage === 'liked' || stage === 'matched')) next = setFrontmatterField(next, 'stage', 'talking');

	const result = await vault.write(path, next, note.hash, { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true, like: readLike(path, result.note.content, result.note.hash, day)! };
}

/** The fields that set `status` by hand on `day`: resolved for yes or no, cleared for pending. */
function resolution(status: LikeStatus, day: DayKey): LikeChange {
	return status === 'pending' ? { status, resolvedDate: null, resolvedBy: null } : { status, resolvedDate: day, resolvedBy: 'manual' };
}

/**
 * The record fields in an untrusted object, checked, with `undefined` for
 * any not given and `null` for unknown; null when one cannot be stored.
 */
function likeFields(raw: Partial<Record<keyof LikeFields, unknown>>): Partial<LikeFields> | null {
	const out: Partial<LikeFields> = {};
	for (const key of ['outOfLeague', 'fitsType', 'commented'] as const) {
		const v = raw[key];
		if (v === undefined) continue;
		if (v !== null && typeof v !== 'boolean') return null;
		out[key] = v;
	}
	if (raw.age !== undefined) {
		if (raw.age !== null && !(typeof raw.age === 'number' && Number.isInteger(raw.age) && raw.age > 0 && raw.age < 130)) return null;
		out.age = raw.age;
	}
	if (raw.likedOn !== undefined) {
		if (raw.likedOn !== null && !isLikedOn(raw.likedOn)) return null;
		out.likedOn = raw.likedOn;
	}
	if (raw.forecast !== undefined) {
		if (typeof raw.forecast !== 'number' || !Number.isFinite(raw.forecast)) return null;
		out.forecast = raw.forecast;
	}
	if (raw.sentDate !== undefined) {
		if (typeof raw.sentDate !== 'string') return null;
		out.sentDate = raw.sentDate;
	}
	return out;
}

/** Every like as the export's JSON: the record schema, oldest first, with what the forecasts predict. */
export async function exportLikes(vault: Vault, day: DayKey = today()) {
	const likes = await loadLikes(vault, day);
	return {
		format: 'prosoche-likes',
		version: 1,
		outcome: OUTCOME,
		exported: day,
		records: likes.map(({ hash: _hash, ...record }) => record)
	};
}

interface ImportReport {
	ok: true;
	created: number;
	updated: number;
	unchanged: number;
	/** One line per record that could not be imported, saying why. */
	problems: string[];
}

/**
 * Import likes from an export, this one's (`{ records: [...] }`) or the old
 * shape (a bare array, or records named the way the notes spell them:
 * `name`, `liked`, `chance`, `stage`, `out_of_league` and so on).
 *
 * A record whose label has no note becomes a new like, as `addLike` makes
 * one, with its status and resolution as given. A record whose label has a
 * note updates that note's fields one line each with every value given that
 * is not null: an import fills in and corrects, and never forgets what a
 * note knows or deletes anything. The next `loadLikes` settles all of it.
 * Never throws on a bad record; it is reported in `problems` and skipped.
 */
export async function importLikes(vault: Vault, data: unknown, day: DayKey = today()): Promise<ImportReport | { ok: false; reason: 'invalid' }> {
	const records = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { records?: unknown }).records) ? (data as { records: unknown[] }).records : null;
	if (!records) return { ok: false, reason: 'invalid' };
	const report: ImportReport = { ok: true, created: 0, updated: 0, unchanged: 0, problems: [] };

	for (const [i, item] of records.entries()) {
		const r = normaliseImport(item);
		const where = `Record ${i + 1}${r?.label ? ` (${r.label})` : ''}`;
		if (!r) {
			report.problems.push(`${where}: needs a label and a forecast.`);
			continue;
		}
		const fields = likeFields(r.fields);
		if (!fields || (r.fields.sentDate !== undefined && !isDayKey(String(r.fields.sentDate)))) {
			report.problems.push(`${where}: a field has a value that cannot be stored.`);
			continue;
		}
		const resolved: LikeChange = {};
		if (r.status) Object.assign(resolved, { status: r.status, resolvedDate: r.resolvedDate, resolvedBy: r.resolvedBy });

		const path = personPath(r.label);
		const note = await vault.read(path, { scope: 'private' });
		if (!note.exists) {
			const added = await addLike(vault, { ...fields, label: r.label, notes: r.notes ?? undefined, forecast: r.fields.forecast as number }, day);
			if (!added.ok) {
				report.problems.push(`${where}: ${added.reason}.`);
				continue;
			}
			if (r.status) {
				const after = await vault.read(path, { scope: 'private' });
				await vault.write(path, editLike(after.content, dropNulls(resolved)), after.hash, { scope: 'private' });
			}
			report.created++;
			continue;
		}
		const current = readLike(path, note.content, note.hash, day);
		const next = editLike(note.content, changedFrom(current, dropNulls({ ...fields, ...resolved })));
		if (next === note.content) {
			report.unchanged++;
			continue;
		}
		const written = await vault.write(path, next, note.hash, { scope: 'private' });
		if (written.ok) report.updated++;
		else report.problems.push(`${where}: its note changed while importing.`);
	}
	return report;
}

/**
 * Only the fields of `change` whose value differs from what `like` already
 * reads as, so an import that agrees with a note leaves its bytes alone.
 * Everything, when the note is not a like yet.
 */
function changedFrom(like: Like | null, change: LikeChange): LikeChange {
	if (!like) return change;
	return Object.fromEntries(
		Object.entries(change).filter(([k, v]) => (k === 'forecast' ? clampForecast(v as number) : v) !== like[k as keyof Like])
	) as LikeChange;
}

/** `change` without its null values, so an import never clears what a note knows. */
function dropNulls(change: LikeChange): LikeChange {
	return Object.fromEntries(Object.entries(change).filter(([, v]) => v !== null && v !== undefined)) as LikeChange;
}

/**
 * One imported record in either shape, with its fields under the record's
 * names; null when it has no label or no numeric forecast.
 */
function normaliseImport(item: unknown): {
	label: string;
	notes: string | null;
	status: LikeStatus | null;
	resolvedDate: string | null;
	resolvedBy: 'manual' | 'auto' | null;
	fields: Partial<Record<keyof LikeFields, unknown>>;
} | null {
	if (!item || typeof item !== 'object') return null;
	const o = item as Record<string, unknown>;
	const pick = (...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined);
	const label = pick('label', 'name', 'id');
	const forecast = Number(pick('forecast', 'chance'));
	if (typeof label !== 'string' || !personName(label) || !Number.isFinite(forecast)) return null;

	const bool = (v: unknown) => (typeof v === 'boolean' ? v : v === 'true' || v === 'yes' ? true : v === 'false' || v === 'no' ? false : null);
	const day = (v: unknown) => (typeof v === 'string' && isDayKey(v) ? v : v instanceof Date ? v.toISOString().slice(0, 10) : undefined);
	const statusRaw = pick('status');
	const stage = pick('stage');
	const status = (LIKE_STATUSES as readonly string[]).includes(String(statusRaw))
		? (statusRaw as LikeStatus)
		: typeof stage === 'string' && stageMeansReply(stage)
			? 'yes'
			: null;
	const ageRaw = pick('age');
	const age = ageRaw === null || ageRaw === undefined || ageRaw === '' ? null : Number(ageRaw);
	const likedOn = pick('likedOn', 'liked_on');
	const sent = pick('sentDate', 'liked', 'date');
	const resolvedBy = pick('resolvedBy', 'resolved_by');

	return {
		label: personName(label),
		notes: typeof o.notes === 'string' ? o.notes : null,
		status,
		resolvedDate: day(pick('resolvedDate', 'resolved')) ?? (status && status !== 'pending' ? (day(sent) ?? null) : null),
		resolvedBy: resolvedBy === 'manual' || resolvedBy === 'auto' ? resolvedBy : status && status !== 'pending' ? 'manual' : null,
		fields: {
			forecast,
			sentDate: sent === undefined ? undefined : day(sent) ?? String(sent),
			outOfLeague: bool(pick('outOfLeague', 'out_of_league')),
			fitsType: bool(pick('fitsType', 'fits_type')),
			commented: bool(pick('commented')),
			age: age !== null && Number.isInteger(age) && age > 0 ? age : null,
			likedOn: likedOn === 'photo' || likedOn === 'prompt' ? likedOn : null
		}
	};
}

/* ---------------------------------------------------------------- Type --- */

/**
 * The user's own note on their type, `Private/Dating/Type.md`: its text as
 * on disk, rendered, and the hash to save with. A missing note reads as
 * empty. Never writes.
 */
export async function loadTypeNote(vault: Vault): Promise<{ path: string; exists: boolean; raw: string; hash: string; html: string }> {
	const note = await vault.read(TYPE_NOTE_PATH, { scope: 'private' });
	return {
		path: TYPE_NOTE_PATH,
		exists: note.exists,
		raw: note.content,
		hash: note.exists ? note.hash : hashContent(''),
		html: note.exists ? renderMarkdown(parseNote(note.content, TYPE_NOTE_PATH).body) : ''
	};
}

/**
 * Save the type note whole: the user's own text, typed into the editor, so a
 * whole-file write is allowed. Refuses with `conflict`, writing nothing, when
 * the note changed since `expectedHash` was read; the first save creates it.
 */
export async function saveTypeNote(vault: Vault, content: string, expectedHash: string): Promise<{ ok: true } | { ok: false; reason: 'conflict' }> {
	const note = await vault.read(TYPE_NOTE_PATH, { scope: 'private' });
	if ((note.exists ? note.hash : hashContent('')) !== expectedHash) return { ok: false, reason: 'conflict' };
	const result = await vault.write(TYPE_NOTE_PATH, content, expectedHash, { scope: 'private' });
	return result.ok ? { ok: true } : { ok: false, reason: 'conflict' };
}

/* ------------------------------------------------------------ Insights --- */

/** Everything Insights is allowed to see: the ledger and every person's dates log, nothing else. */
export interface InsightsSource {
	asOf: DayKey;
	ledger: Array<{ day: DayKey; counts: LedgerCounts; notes: string }>;
	people: Array<{ name: string; stage: Stage | null; dates: DateEntry[] }>;
}

/**
 * Gather the data a dating Insights run may use.
 *
 * The only function outside the Log/People helpers above that reads private
 * scope, and the last one: everything it returns is plain data (numbers and
 * strings already pulled out of the notes), so `ai/dating-insights.ts` never
 * has to touch the vault, let alone ask for private scope itself.
 */
export async function gatherInsightsSource(vault: Vault): Promise<InsightsSource> {
	const { entries } = await loadLedger(vault);
	const people = await listDatingPeople(vault);
	const withDates = await Promise.all(
		people.map(async (p) => {
			const full = await loadDatingPerson(vault, p.name);
			return { name: p.name, stage: p.stage, dates: full.dates };
		})
	);
	return {
		asOf: today(),
		ledger: entries.map((e) => ({ day: e.day, counts: { sent: e.sent, matches: e.matches, type: e.type, received: e.received }, notes: e.notes })),
		people: withDates
	};
}

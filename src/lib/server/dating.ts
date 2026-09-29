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
 *
 * The stats functions are pure — they take entries already read, not a vault
 * — so they can be table-tested without touching the filesystem at all.
 */

import { shiftDay, today, type DayKey } from './daily';
import { newDateLine, rewriteStageLine, scanDates, type DateEntry } from './parse/dating-person';
import { newLedgerLine, saveLedgerDay, scanLedger, ZERO_COUNTS, type LedgerCounts, type LedgerLine } from './parse/ledger';
import { basename, parseNote } from './parse/note';
import { personName } from './people';
import { appendUnderHeading } from './sections';
import { hashContent, type Vault } from './vault/index';

export const DATING_FOLDER = 'Private/Dating';
export const LEDGER_PATH = `${DATING_FOLDER}/Ledger.md`;
export const PEOPLE_FOLDER = `${DATING_FOLDER}/People`;
const DATES_HEADING = '## Dates';

export const STAGES = ['matched', 'talking', 'date planned', 'dating', 'ended'] as const;
export type Stage = (typeof STAGES)[number];

function asStage(value: unknown): Stage | null {
	return typeof value === 'string' && (STAGES as readonly string[]).includes(value) ? (value as Stage) : null;
}

function text(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	return String(value);
}

/* ------------------------------------------------------------------ Log --- */

export interface DayEntry extends LedgerCounts {
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

export type SaveDayResult = { ok: true; hash: string } | { ok: false; reason: 'conflict' };

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

export interface RangeStats {
	/** Calendar days the range covers: 7, 30, or the span since the first logged day. */
	days: number;
	totals: LedgerCounts;
	/** matches / sent. Null when nothing was sent, rather than zero. */
	matchRate: number | null;
	/** type / matches. Null when there were no matches. */
	typeRate: number | null;
	receivedPerDay: number | null;
}

export type RangeKind = '7d' | '30d' | 'all';

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

export interface WeekPoint {
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

export interface WeekdayStat {
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

/** Calendar days between two `YYYY-MM-DD` days, `b - a`, so same-day is 0. */
function daysBetween(a: DayKey, b: DayKey): number {
	const [ay, am, ad] = a.split('-').map(Number);
	const [by, bm, bd] = b.split('-').map(Number);
	const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
	return Math.round(ms / 86_400_000);
}

/* -------------------------------------------------------------- People --- */

export interface DatingPersonSummary {
	name: string;
	path: string;
	app: string | null;
	age: string | null;
	place: string | null;
	job: string | null;
	stage: Stage | null;
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
		stage: asStage(frontmatter.stage)
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

export interface DatingPerson extends DatingPersonSummary {
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

export type AddPersonResult = { ok: true; path: string } | { ok: false; reason: 'no-name' | 'exists' };

/** Create a new dating person's note. Refuses rather than overwrites one that already exists. */
export async function addDatingPerson(
	vault: Vault,
	fields: { name: string; app?: string; age?: string; place?: string; job?: string; stage?: Stage; notes?: string }
): Promise<AddPersonResult> {
	const name = personName(fields.name);
	if (!name) return { ok: false, reason: 'no-name' };
	const path = personPath(name);
	const note = await vault.read(path, { scope: 'private' });
	if (note.exists) return { ok: false, reason: 'exists' };

	const result = await vault.write(path, newPersonNote(name, fields), hashContent(''), { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, path };
}

export type AddDateResult = { ok: true; line: number } | { ok: false; reason: 'no-name' | 'no-text' | 'conflict' };

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

export type SetStageResult = { ok: true } | { ok: false; reason: 'no-note' | 'conflict' };

/** Rewrite a person's frontmatter `stage:` line alone. */
export async function setStage(vault: Vault, rawName: string, stage: Stage): Promise<SetStageResult> {
	const path = personPath(rawName);
	const note = await vault.read(path, { scope: 'private' });
	if (!note.exists) return { ok: false, reason: 'no-note' };

	const result = await vault.write(path, rewriteStageLine(note.content, stage), note.hash, { scope: 'private' });
	if (!result.ok) return { ok: false, reason: 'conflict' };
	return { ok: true };
}

function newPersonNote(
	name: string,
	fields: { app?: string; age?: string; place?: string; job?: string; stage?: Stage; notes?: string }
): string {
	const frontmatter = [
		'---',
		'type: person',
		`app: ${fields.app ?? ''}`,
		`age: ${fields.age ?? ''}`,
		`place: ${fields.place ?? ''}`,
		`job: ${fields.job ?? ''}`,
		`stage: ${fields.stage ?? STAGES[0]}`,
		'---'
	].join('\n');
	const notes = (fields.notes ?? '').trim();
	return `${frontmatter}\n\n# ${name}\n${notes ? `\n${notes}\n` : ''}`;
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

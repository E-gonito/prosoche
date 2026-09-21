/**
 * Time tracking: the `## Time log` section of a daily note, and the one timer
 * that is running.
 *
 * The section holds plain lines rather than tasks, so time already spent never
 * reappears as something still to do:
 *
 *     ## Time log
 *     - 10:42 - 12:05 Work on atlas (1h23m) `Q1` #ws/atlas
 *
 * Three rules hold throughout:
 *
 *  - **Writing is append-only.** Stopping a timer adds one line under the
 *    heading, creating the heading at the end of the note when it is absent. No
 *    existing line is rewritten, reordered or removed, and the note is never
 *    re-serialised from a parsed model.
 *  - **A line this module cannot read is left exactly where it is** and skipped.
 *    A sentence someone typed under the heading is not a parse error.
 *  - **The clock range is the record.** The `(1h23m)` in brackets is written for
 *    a human reading the note in Obsidian; the minutes are always computed from
 *    the two times, so a hand-edited range cannot disagree with its own total.
 *
 * ## Why the running timer is the one thing outside the markdown
 *
 * A timer that has not stopped has no end time, and there is no honest way to
 * write that as an `HH:MM - HH:MM` line. So it is kept in `_hub/timer.json`,
 * written through the `Vault` like any other file, and emptied the moment the
 * timer stops and the fact becomes markdown.
 *
 * That is safe because the file is not a source of truth for anything. It holds
 * a start instant and which line is being timed. Losing it loses at most one
 * unstopped timer, which the user restarts; losing a time log line would lose
 * the record of work actually done. The fragile state is therefore the state
 * whose loss costs nothing, and it survives a page reload, a navigation and a
 * server restart because it is on disk.
 *
 * The alternative considered was writing a provisional `- 10:42 - Work on X`
 * line into the note at start and completing it at stop. Rejected on three
 * counts: completing it means rewriting an existing line, which this module
 * promises never to do; Day Planner and the hub's own timeline both misread a
 * half-written range; and a crash or a closed laptop would leave that broken
 * line in the user's note for ever.
 */

import { appendUnderHeading } from './sections';
import { config } from './config';
import { dailyNotePath, dayOfNote, isDailyNote, shiftDay, type DayKey } from './daily';
import { openDay } from './daily-note';
import { parseTaskLine } from './parse/task';
import { basename, scanTags } from './parse/note';
import { coveredMinutes } from './schedule';
import { workspaceFor, type Workspace } from './workspaces';
import type { NoteIndex } from './index/index';
import type { Vault } from './vault/index';
import { displayText, type Task } from '../shared/task';
import {
	MINUTES_IN_DAY,
	formatDuration,
	parseClock,
	parseDuration,
	spanMinutes,
	type RunningTimer
} from '../shared/duration';
import { formatMinutes } from '../shared/time';

/** The heading the log lives under, written exactly like this when created. */
export const TIME_LOG_HEADING = '## Time log';

/** Where the in-flight timer is parked. See the module comment for why. */
export const TIMER_PATH = `${config.hubFolder}/timer.json`;

/** One line of a `## Time log` section, as read. */
export interface TimeEntry {
	/** Day the line was logged on, or '' when the caller did not say. */
	day: DayKey;
	/** 0-based line in the note it came from. */
	line: number;
	/** The line exactly as written. */
	raw: string;
	startMin: number;
	endMin: number;
	/** Computed from the two times, never from the written duration. */
	minutes: number;
	/** The words, with the duration, quadrant and tags taken out. */
	text: string;
	/** Tags on the line without their `#`, in written order. */
	tags: string[];
	/** The first tag under `ws/`, which is how time is attributed. */
	workspace: string | null;
	quadrant: number | null;
}

/** An entry about to be written. The duration is derived, never supplied. */
export interface NewEntry {
	startMin: number;
	endMin: number;
	text: string;
	workspace?: string | null;
	quadrant?: number | null;
}

/** Where an appended line landed, so a caller can show or test it. */
export interface Appended {
	path: string;
	/** 0-based line the new text occupies. */
	line: number;
	raw: string;
	entry: TimeEntry;
}

const BULLET_TIMES = /^[ \t]*[-*+][ \t]+(\d{1,2}:\d{2})[ \t]*-[ \t]*(\d{1,2}:\d{2})(?=[ \t]|$)/;
const QUADRANT = /`Q([1-4])`/;
const DURATION = /\(([^()]*)\)/g;
const FENCE = /^[ \t]*(```|~~~)/;
const HEADING = /^[ \t]*#{1,6}[ \t]/;

/**
 * Every readable line of the `## Time log` section.
 *
 * Pure. `day` is stamped onto each entry because a log line does not carry its
 * own date — the note it lives in is the date — and a weekly total needs to
 * know which day each line came from.
 *
 * Lines outside the section are ignored, as are lines inside it that are not
 * `- HH:MM - HH:MM ...`, and so is the whole section when it sits inside a code
 * fence. A note with no such heading yields an empty list rather than an error.
 */
export function parseTimeLog(content: string, day: DayKey = ''): TimeEntry[] {
	const lines = content.split('\n');
	const entries: TimeEntry[] = [];
	let fence: string | null = null;
	let inSection = false;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const f = FENCE.exec(raw);
		if (f) {
			if (fence === null) fence = f[1];
			else if (f[1] === fence) fence = null;
			continue;
		}
		if (fence !== null) continue;

		if (HEADING.test(raw)) {
			inSection = raw.trim().toLowerCase() === TIME_LOG_HEADING.toLowerCase();
			continue;
		}
		if (!inSection) continue;

		const entry = parseEntryLine(raw, i, day);
		if (entry) entries.push(entry);
	}
	return entries;
}

/**
 * Read one `- HH:MM - HH:MM ...` line, or null when it is not one.
 *
 * Exported because it is the whole grammar of a log line and worth testing on
 * its own; nothing outside this module needs to call it.
 */
export function parseEntryLine(raw: string, line = 0, day: DayKey = ''): TimeEntry | null {
	const m = BULLET_TIMES.exec(raw);
	if (!m) return null;
	const startMin = parseClock(m[1]);
	const endMin = parseClock(m[2]);
	if (startMin === null || endMin === null) return null;

	const rest = raw.slice(m[0].length);
	const tags = scanTags(rest);
	const quadrant = QUADRANT.exec(rest);

	// Take out the tokens that are metadata, leaving the words. Only brackets
	// whose contents read as a duration go: `(with Ada)` is part of the words.
	let text = rest;
	for (const tag of [...tags].reverse()) text = text.slice(0, tag.start) + text.slice(tag.end);
	text = text.replace(QUADRANT, ' ');
	text = text.replace(DURATION, (whole, inner: string) => (parseDuration(inner) === null ? whole : ' '));

	return {
		day,
		line,
		raw,
		startMin,
		endMin,
		minutes: spanMinutes(startMin, endMin),
		text: text.replace(/\s+/g, ' ').trim(),
		tags: tags.map((t) => t.tag),
		workspace: tags.map((t) => t.tag).find((t) => t === 'ws' || t.startsWith('ws/')) ?? null,
		quadrant: quadrant ? Number(quadrant[1]) : null
	};
}

/**
 * The line an entry is written as: times, words, duration in brackets, then the
 * quadrant and workspace tag when the timed task had them.
 *
 * The quadrant is an addition to the spec's example, kept because this vault
 * writes quadrants as inline code and it is the only way a week can be summed
 * by quadrant without guessing which task each line came from. Like every other
 * marker in this app, it is written only when there is one to write.
 */
export function formatEntry(entry: NewEntry): string {
	const minutes = spanMinutes(entry.startMin, entry.endMin);
	const parts = [
		`- ${formatMinutes(entry.startMin)} - ${formatMinutes(entry.endMin)}`,
		entry.text.replace(/\s+/g, ' ').trim(),
		`(${formatDuration(minutes)})`
	];
	if (entry.quadrant) parts.push(`\`Q${entry.quadrant}\``);
	if (entry.workspace) parts.push(`#${entry.workspace}`);
	return parts.filter(Boolean).join(' ');
}

/**
 * Append one entry to a day's `## Time log`.
 *
 * Creates the day's note from the vault template when it does not exist, so
 * stopping a timer is never refused for want of a note, and creates the heading
 * when the note has none. Writes exactly one line and touches nothing else.
 *
 * Retries once when the note changed underneath, because a time log line is a
 * record of work and must not be lost to a race with the editor. Never
 * rewrites, reorders or removes a line, and never updates frontmatter.
 */
export async function appendEntry(vault: Vault, day: DayKey, entry: NewEntry): Promise<Appended> {
	const path = dailyNotePath(day);
	const raw = formatEntry(entry);

	for (let attempt = 0; attempt < 2; attempt++) {
		const note = attempt === 0 ? await openDay(vault, day) : await vault.read(path);
		const next = appendUnderHeading(note.content, TIME_LOG_HEADING, raw);
		const result = await vault.write(path, next.content, note.hash);
		if (result.ok) {
			return { path, line: next.line, raw, entry: parseEntryLine(raw, next.line, day)! };
		}
	}

	// Two clashing writes in a row: write without a guard rather than drop the
	// line. The append is additive, so the worst case is losing a keystroke
	// someone typed in the same instant, not losing the record.
	const note = await vault.read(path);
	const next = appendUnderHeading(note.content, TIME_LOG_HEADING, raw);
	await vault.write(path, next.content);
	return { path, line: next.line, raw, entry: parseEntryLine(raw, next.line, day)! };
}

/** Planned against logged for one day, matched by the words of the task. */
export interface PlannedVsActual {
	/**
	 * Minutes of the day covered by at least one planned block. Overlaps count
	 * once, because a long "work" block containing shorter ones is the normal
	 * shape of these days and summing durations would claim more hours than the
	 * day has.
	 */
	plannedMinutes: number;
	/** Minutes logged. Summed, since a timer cannot produce two at once. */
	loggedMinutes: number;
	rows: Array<{
		path: string;
		line: number;
		text: string;
		quadrant: number | null;
		plannedMinutes: number;
		loggedMinutes: number;
	}>;
	/** Logged time that matched nothing planned: work that was not on the plan. */
	unmatched: Array<{ text: string; minutes: number }>;
}

/**
 * Compare a day's plan with what was logged against it.
 *
 * Pure. Matching is by the words of the task, because a log line records what
 * was done rather than which line it came from: an exact match first, then one
 * name containing the other, longest plan first so "Work on atlas" wins over
 * "Work". Anything left over is reported as unmatched rather than guessed at.
 *
 * A planned block with nothing logged appears with zero logged minutes, which
 * is the interesting case and so is never dropped.
 */
export function plannedVsActual(scheduled: Task[], entries: TimeEntry[]): PlannedVsActual {
	const blocks = scheduled.filter((t) => t.startMin !== null && t.endMin !== null);
	const rows = blocks.map((task) => ({
		path: task.path,
		line: task.line,
		text: displayText(task.text),
		quadrant: task.quadrant,
		plannedMinutes: spanMinutes(task.startMin!, task.endMin!),
		loggedMinutes: 0,
		key: matchKey(task.text)
	}));
	// Longest name first, so the most specific plan claims an entry.
	const order = [...rows].sort((a, b) => b.key.length - a.key.length);
	const unmatched: Array<{ text: string; minutes: number }> = [];

	for (const entry of entries) {
		const key = matchKey(entry.text);
		const row = order.find((r) => r.key === key) ?? order.find((r) => r.key && key && (r.key.includes(key) || key.includes(r.key)));
		if (row) row.loggedMinutes += entry.minutes;
		else unmatched.push({ text: entry.text, minutes: entry.minutes });
	}

	return {
		plannedMinutes: coveredMinutes(blocks),
		loggedMinutes: entries.reduce((sum, e) => sum + e.minutes, 0),
		rows: rows.map(({ key: _key, ...row }) => row),
		unmatched
	};
}

/** Totals over a set of days, by workspace and by quadrant. */
export interface WeeklyTotals {
	minutes: number;
	/** One row per day, in the order asked for, zeroes included. */
	byDay: Array<{ day: DayKey; minutes: number }>;
	byWorkspace: Array<{ slug: string; name: string; color: string; minutes: number }>;
	/** Quadrant 1..4, or null for time logged against an unclassified task. */
	byQuadrant: Array<{ quadrant: number | null; minutes: number }>;
}

/** Colour for time that belongs to no workspace, matching the Q4 grey. */
const UNASSIGNED = { slug: '', name: 'Unassigned', color: '#9aa0a6' };

/**
 * Sum entries by workspace, by quadrant and by day.
 *
 * Pure. `days` fixes the range: when given, `byDay` has exactly those days in
 * that order including the ones with nothing logged, so a chart has a bar per
 * day without the caller filling the gaps. Without it the range is whichever
 * days the entries mention, sorted.
 *
 * A workspace tag naming no known workspace is counted as unassigned rather
 * than dropped, so the totals always add up to the time logged.
 */
export function weekly(entries: TimeEntry[], workspaces: Workspace[], days?: DayKey[]): WeeklyTotals {
	const range = days ?? [...new Set(entries.map((e) => e.day))].sort();
	const perDay = new Map(range.map((day) => [day, 0]));
	const perWorkspace = new Map<string, number>();
	const perQuadrant = new Map<number | null, number>();

	for (const entry of entries) {
		if (perDay.has(entry.day)) perDay.set(entry.day, perDay.get(entry.day)! + entry.minutes);
		const slug = workspaces.find((w) => w.tag === entry.workspace)?.slug ?? UNASSIGNED.slug;
		perWorkspace.set(slug, (perWorkspace.get(slug) ?? 0) + entry.minutes);
		perQuadrant.set(entry.quadrant, (perQuadrant.get(entry.quadrant) ?? 0) + entry.minutes);
	}

	const byWorkspace = [...perWorkspace]
		.map(([slug, minutes]) => {
			const w = workspaces.find((ws) => ws.slug === slug) ?? UNASSIGNED;
			return { slug, name: w.name, color: w.color, minutes };
		})
		.sort((a, b) => b.minutes - a.minutes);

	return {
		minutes: [...perDay.values()].reduce((a, b) => a + b, 0),
		byDay: range.map((day) => ({ day, minutes: perDay.get(day) ?? 0 })),
		byWorkspace,
		byQuadrant: [...perQuadrant]
			.map(([quadrant, minutes]) => ({ quadrant, minutes }))
			.sort((a, b) => (a.quadrant ?? 9) - (b.quadrant ?? 9))
	};
}

/** The seven days, Monday first, of the week containing `day`. */
export function weekOf(day: DayKey): DayKey[] {
	const [y, m, d] = day.split('-').map(Number);
	const weekday = new Date(y, m - 1, d).getDay();
	const monday = shiftDay(day, -((weekday + 6) % 7));
	return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}

/**
 * Read the log lines of several days. A day with no note contributes nothing,
 * so a range that reaches into the future is not an error.
 */
export async function loadEntries(vault: Vault, days: DayKey[]): Promise<TimeEntry[]> {
	const entries: TimeEntry[] = [];
	for (const day of days) {
		const note = await vault.read(dailyNotePath(day));
		if (note.exists) entries.push(...parseTimeLog(note.content, day));
	}
	return entries;
}

/** Everything the Time widget renders, for one week and one scope. */
export interface WeekSummary {
	days: Array<{ day: DayKey; plannedMinutes: number; loggedMinutes: number }>;
	plannedMinutes: number;
	loggedMinutes: number;
	byWorkspace: WeeklyTotals['byWorkspace'];
	byQuadrant: WeeklyTotals['byQuadrant'];
	/** Work that was logged but never planned, biggest first. */
	unmatched: Array<{ text: string; minutes: number }>;
	/** True when a workspace narrowed the figures. */
	scoped: boolean;
}

/**
 * A week of planned-against-logged, optionally narrowed to one workspace.
 *
 * Reads the days' notes and asks the index for their scheduled tasks; the
 * arithmetic is all in the pure functions above. One call, so the widget holds
 * no domain logic.
 *
 * Scoping uses the same rule as everything else: a log line belongs to the
 * workspace whose tag it carries, a planned block to the workspace its tag or
 * its folder gives it. Daily notes belong to no folder, so a scoped week shows
 * planned time only for blocks that carry the tag.
 */
export async function weekSummary(
	vault: Vault,
	index: NoteIndex,
	opts: { days: DayKey[]; workspaces: Workspace[]; workspace: Workspace | null }
): Promise<WeekSummary> {
	const { days, workspaces, workspace } = opts;
	const all = await loadEntries(vault, days);
	const entries = workspace ? all.filter((e) => e.workspace === workspace.tag) : all;
	const week = weekly(entries, workspaces, days);

	const planned = days.map((day) => {
		const blocks = index
			.tasksIn(dailyNotePath(day))
			.filter((t) => !t.fenced && t.startMin !== null && t.endMin !== null)
			.filter((t) => !workspace || workspaceFor(workspaces, { path: t.path, tags: t.tags })?.slug === workspace.slug);
		return plannedVsActual(blocks, entries.filter((e) => e.day === day));
	});

	return {
		days: week.byDay.map((d, i) => ({
			day: d.day,
			loggedMinutes: d.minutes,
			plannedMinutes: planned[i].plannedMinutes
		})),
		plannedMinutes: planned.reduce((sum, p) => sum + p.plannedMinutes, 0),
		loggedMinutes: week.minutes,
		byWorkspace: week.byWorkspace,
		byQuadrant: week.byQuadrant,
		unmatched: planned
			.flatMap((p) => p.unmatched)
			.sort((a, b) => b.minutes - a.minutes)
			.slice(0, 6),
		scoped: workspace !== null
	};
}

/**
 * The timer that is running, or null when none is.
 *
 * Anything unreadable in the timer file — absent, empty, half-written, from an
 * older version — reads as "no timer", because the only cost of getting that
 * wrong is the user pressing start again.
 */
export async function currentTimer(vault: Vault): Promise<RunningTimer | null> {
	return readTimer((await vault.read(TIMER_PATH)).content);
}

/** The timer file's contents as a timer, or null. Pure, so it can be tested. */
export function readTimer(content: string): RunningTimer | null {
	if (!content.trim()) return null;
	try {
		const raw = JSON.parse(content) as Partial<RunningTimer>;
		if (typeof raw.path !== 'string' || typeof raw.line !== 'number') return null;
		if (typeof raw.startedAt !== 'string' || Number.isNaN(Date.parse(raw.startedAt))) return null;
		return {
			path: raw.path,
			line: raw.line,
			text: typeof raw.text === 'string' && raw.text ? raw.text : basename(raw.path),
			workspace: typeof raw.workspace === 'string' ? raw.workspace : null,
			quadrant: typeof raw.quadrant === 'number' ? raw.quadrant : null,
			startedAt: raw.startedAt,
			day: typeof raw.day === 'string' ? raw.day : dayOf(raw.startedAt)
		};
	} catch {
		return null;
	}
}

/**
 * Start timing the task at `path`:`line`, stopping and logging whatever was
 * running first.
 *
 * One timer at a time, on purpose: a second start is the user saying they have
 * moved on, so it records the move rather than refusing. Returns the new timer
 * and the entry the previous one wrote, if any.
 *
 * Never fails on the content of the line. A line that does not parse as a task
 * is timed under its own text, and a path with no note under the note's name,
 * because a mislabelled entry is fixable in Obsidian and a refused start loses
 * the time.
 */
export async function startTimer(
	vault: Vault,
	workspaces: Workspace[],
	spec: { path: string; line: number },
	now = new Date()
): Promise<{ timer: RunningTimer; stopped: Appended | null }> {
	const stopped = await stopTimer(vault, now);

	const note = await vault.read(spec.path);
	const raw = note.content.split('\n')[spec.line] ?? '';
	const task = parseTaskLine(raw, spec.line);
	const tags = task ? task.tags : [];
	// A line that is not a task is timed under its own words: heading hashes,
	// bullet and checkbox come off, and an empty line falls back to the note.
	const text = displayText(task?.text ?? raw.replace(/^[ \t]*(#{1,6}[ \t]+)?([-*+][ \t]+)?(\[.\][ \t]+)?/, '')) || basename(spec.path);

	const timer: RunningTimer = {
		path: spec.path,
		line: spec.line,
		text,
		// Resolved once, here, and written onto the log line at stop: a line that
		// only made sense while the folder layout stayed put would not survive a
		// reorganisation of the vault.
		workspace: workspaceFor(workspaces, { path: spec.path, tags })?.tag ?? null,
		quadrant: task?.quadrant ?? null,
		startedAt: now.toISOString(),
		day: dayOf(now.toISOString())
	};

	await vault.write(TIMER_PATH, `${JSON.stringify(timer, null, '\t')}\n`);
	return { timer, stopped };
}

/**
 * Stop the running timer and append what it measured to its day's time log.
 *
 * Returns null when nothing was running, so a stop is always safe to send: a
 * second tab pressing stop is not an error.
 *
 * Durations are whole minutes. A timer stopped inside a minute records one
 * minute, because a zero-length line says nothing while a missing line loses
 * the fact that the work happened. One left running for more than a day records
 * just under a day, so that the clock range on the line can still express its
 * own total; the user can correct the line in Obsidian.
 */
export async function stopTimer(vault: Vault, now = new Date()): Promise<Appended | null> {
	const file = await vault.read(TIMER_PATH);
	const timer = readTimer(file.content);
	if (!timer) return null;

	// Claim the stop before writing the line. The caller that empties the file
	// is the one that logs the entry, so two tabs pressing stop at once cannot
	// log the same stretch of work twice. An empty object is what `readTimer`
	// already reads as "nothing running"; the vault module writes files rather
	// than deleting them.
	if (!(await vault.write(TIMER_PATH, '{}\n', file.hash)).ok) return null;

	const elapsed = (now.getTime() - Date.parse(timer.startedAt)) / 60000;
	const minutes = Math.min(MINUTES_IN_DAY - 1, Math.max(1, Math.round(elapsed)));
	const started = new Date(Date.parse(timer.startedAt));
	const startMin = started.getHours() * 60 + started.getMinutes();

	return appendEntry(vault, timer.day, {
		startMin,
		endMin: (startMin + minutes) % MINUTES_IN_DAY,
		text: timer.text,
		workspace: timer.workspace,
		quadrant: timer.quadrant
	});
}

/** Local calendar day of an ISO instant. A day is a label, not an instant. */
function dayOf(iso: string): DayKey {
	const at = new Date(Date.parse(iso));
	return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

/** Task text reduced to something two spellings of the same work agree on. */
function matchKey(text: string): string {
	return displayText(text).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

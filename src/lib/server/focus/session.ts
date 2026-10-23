/**
 * A focus session: one daily-note block, a timer, and what came of it. A study
 * block also carries its subject's one step.
 *
 * A session starts from a block (`/focus/start`, the strip, Today) or from a
 * subject's page, and is kept in `_hub/.state/focus-session.json`, which git
 * sync never offers for commit, so closing the tab or opening it on another
 * device finds it still running. Only one runs at a time. Its outcome is the
 * single thing written to the vault: a sub-bullet under the day's block in the
 * daily note (see `study/block.ts`), a tick on that block, and, for a study
 * session that ended Done, a tick on the step in `Goals.md`. There is no log
 * file.
 *
 * Designed twice (docs/plan-start.md): one module with the block as the core
 * and the study step optional, over a separate timer for non-study blocks.
 * One module means one state file, one "busy" rule and one place that knows
 * the sub-bullet.
 *
 * A session is five minutes of commitment, not the whole block: `warmupMin`
 * is captured at start so that changing the setting later does not move a
 * running session. Showing that is the view's business; the length here is the
 * block's.
 *
 * Every write here is a guarded one-line edit or an insertion; nothing
 * re-serialises a note. A write that clashes is retried against what is there
 * now, and a part that cannot be made (the step's line moved, the day's note
 * does not exist) is reported in `warnings` rather than failing the outcome.
 */

import { config } from '../config';
import { dailyNotePath, type DayKey } from '../daily';
import { parseTaskLine, rewriteTaskLine, scanTasks, type TaskLine } from '../parse/task';
import { rewrite, type Written } from '../rewrite';
import { appendUnderHeading } from '../sections';
import { updateTask } from '../tasks';
import { blockFor, outcomeLine, toBlock, withBullet, type Block } from '../study/block';
import type { Outcome } from '$lib/shared/study';
import { DEFAULT_WARMUP_MINUTES } from '$lib/shared/focus';
import { OPEN_STATUSES } from '$lib/shared/task';
import { formatMinutes } from '$lib/shared/time';
import type { Vault } from '../vault/index';

const STATE = `${config.hubFolder}/.state/focus-session.json`;
/** Where a running study session lived before sessions were generalised. Read once, then moved. */
const OLD_STATE = `${config.hubFolder}/.state/study-session.json`;

/** The quadrant a study session's block is written with when none existed: important, never urgent. */
const QUADRANT = '`Q2`';

/** The label a non-study block's sub-bullet carries, in the place a subject's name takes for study. */
const FOCUS_LABEL = 'Focus';

export { DEFAULT_WARMUP_MINUTES };
const MAX_WARMUP_MINUTES = 60;

/** The daily-note block a session belongs to, as last seen. Plain data. */
export interface BlockRef {
	/** The task line exactly as it was in the note: the guard every write is checked against. */
	raw: string;
	/** 0-based line it was at: a hint. -1 when unknown (a migrated session); the line is then found by `raw`. */
	line: number;
	/** Minutes since midnight, or null when the line carries no times (study only). */
	startMin: number | null;
	endMin: number | null;
	/** The block's words without its time range and quadrant. */
	text: string;
}

interface Common {
	/** Epoch milliseconds the timer started. */
	startedAt: number;
	/** Planned length in minutes; "+15 min" adds to it. Never less than `warmupMin`. */
	minutes: number;
	/** The warm-up the author was promised at Start, in minutes. */
	warmupMin: number;
	/** The day the session started, which is the day's note it is logged in. */
	day: DayKey;
}

/** A session on any timed block. */
export interface BlockSession extends Common {
	kind: 'block';
	block: BlockRef;
}

/** A study session: a subject, its one step, and the subject's block if there was one. */
export interface StudySession extends Common {
	kind: 'study';
	subject: string;
	name: string;
	/** The subject's name and aliases, to find its block again if the line was edited. */
	names: string[];
	step: { path: string; line: number; raw: string; text: string; first: string | null; est: string | null };
	/** The daily-note block it belongs to, or null when it was started without one. */
	block: BlockRef | null;
}

export type Session = BlockSession | StudySession;

/** A refusal: a reason for the route's table and a sentence to show. */
export type Refused = { ok: false; reason: string; message: string };

const refused = (reason: string, message: string): Refused => ({ ok: false, reason, message });

/** The words the session is called in a sentence: the subject's name, or the block's text. */
export function sessionName(session: Session): string {
	return session.kind === 'study' ? session.name : session.block.text;
}

/**
 * The raws of the daily-note blocks `session` covers: one while it runs and
 * has a block, none for no session or a study session started without one. Pure.
 */
export function startedRaws(session: Session | null): string[] {
	return session?.block ? [session.block.raw] : [];
}

/** The text of a task line's words, for a session migrated from before blocks carried it. */
const textOf = (raw: string) => parseTaskLine(raw, 0)?.text ?? raw;

/** A session out of JSON, from this version or the study-only one before it; null when it is neither. */
function parseSession(json: string): Session | null {
	let s: any;
	try {
		s = JSON.parse(json);
	} catch {
		return null;
	}
	if (!s || typeof s.startedAt !== 'number') return null;
	const warmupMin = typeof s.warmupMin === 'number' ? s.warmupMin : DEFAULT_WARMUP_MINUTES;
	const b = s.block;
	const block: BlockRef | null =
		b && typeof b.raw === 'string'
			? { raw: b.raw, line: typeof b.line === 'number' ? b.line : -1, startMin: b.startMin ?? null, endMin: b.endMin ?? null, text: typeof b.text === 'string' ? b.text : textOf(b.raw) }
			: null;
	const common = { startedAt: s.startedAt, minutes: s.minutes, warmupMin, day: s.day };
	if (s.kind === 'block') return block ? { ...common, kind: 'block', block } : null;
	if (!s.step) return null;
	return { ...common, kind: 'study', subject: s.subject, name: s.name, names: Array.isArray(s.names) ? s.names : [s.name], step: s.step, block };
}

/**
 * The running session, or null. A missing or unreadable state file means none
 * is running.
 *
 * One side effect, once: when there is no state file but the old
 * `study-session.json` exists, it is read as a study session, written to the
 * new file and removed, so a session running across the deploy carries on. An
 * old file that cannot be read is removed and reads as none.
 */
export async function readSession(vault: Vault): Promise<Session | null> {
	const note = await vault.read(STATE);
	if (note.exists) return parseSession(note.content);
	const old = await vault.read(OLD_STATE);
	if (!old.exists) return null;
	const session = parseSession(old.content);
	if (session) await save(vault, session);
	await vault.remove(OLD_STATE);
	return session;
}

const save = (vault: Vault, session: Session) => vault.write(STATE, JSON.stringify(session, null, 2) + '\n');

const warmupOf = (warmupMin?: number) =>
	typeof warmupMin === 'number' && Number.isFinite(warmupMin) ? Math.min(MAX_WARMUP_MINUTES, Math.max(1, Math.round(warmupMin))) : DEFAULT_WARMUP_MINUTES;

/** What starting answers when a session is already running that is not the one asked for. */
const busy = (running: Session) => refused('busy', `Finish ${running.kind === 'study' ? `the ${running.name} session` : `"${running.block.text}"`} first.`);

/**
 * The task for `ref` in `content`: the unfenced line at `ref.line` if it is
 * still exactly `ref.raw`, else the first unfenced line that is. Null when the
 * block is gone or was edited. Pure.
 */
function locate(content: string, ref: Pick<BlockRef, 'raw' | 'line'>): TaskLine | null {
	const same = scanTasks(content).filter((t) => !t.fenced && t.raw === ref.raw);
	return same.find((t) => t.line === ref.line) ?? same[0] ?? null;
}

type TimedBlock = BlockRef & { startMin: number; endMin: number };

/** `task` as a block a session can start on: open, with a start and a later end. Null otherwise. Pure. */
function timedBlock(task: TaskLine): TimedBlock | null {
	const b = toBlock(task);
	if (!OPEN_STATUSES.includes(task.status) || b.startMin === null || b.endMin === null || b.endMin <= b.startMin) return null;
	return { raw: task.raw, line: task.line, startMin: b.startMin, endMin: b.endMin, text: task.text };
}

/**
 * The block at 0-based `line` of `day`'s note, if that line is an open task
 * with a start and a later end time outside a code fence; else null (a missing
 * note, a ticked task, a line with no times and a line that is not a task all
 * read as null). For showing what a link to start a block points at. Read-only.
 */
export async function openBlockAt(vault: Vault, day: DayKey, line: number): Promise<TimedBlock | null> {
	const note = await vault.read(dailyNotePath(day));
	const task = note.exists ? scanTasks(note.content).find((t) => t.line === line && !t.fenced) : undefined;
	return task ? timedBlock(task) : null;
}

/**
 * Start a session on the block at `line` of `day`'s note, whose text must
 * still be exactly `raw` (or be found elsewhere in the note by that text).
 *
 * The length is the block's, but never less than the warm-up: started inside
 * the block, from now to its end; started before it or after it, the block's
 * whole length. `warmupMin` (default `DEFAULT_WARMUP_MINUTES`, kept between 1
 * and 60) is captured into the session.
 *
 * Answers the session already running when it is for the same block (starting
 * twice is harmless). Refuses `busy` naming the running one, `moved` when the
 * note or the block is gone, and `not-a-block` for a line that is not an open
 * task with a start and an end time. Writes only the state file.
 */
export async function startBlockSession(
	vault: Vault,
	at: { day: DayKey; line: number; raw: string },
	now: number,
	warmupMin?: number
): Promise<{ ok: true; session: Session } | Refused> {
	const running = await readSession(vault);
	if (running) return running.day === at.day && running.block?.raw === at.raw ? { ok: true, session: running } : busy(running);

	const note = await vault.read(dailyNotePath(at.day));
	const task = note.exists ? locate(note.content, at) : null;
	if (!task) return refused('moved', 'That block is not in the note any more.');
	const block = timedBlock(task);
	if (!block) return refused('not-a-block', 'That is not an open block with a start and an end time.');
	const warmup = warmupOf(warmupMin);
	const clock = new Date(now);
	const nowMin = clock.getHours() * 60 + clock.getMinutes();
	const inside = nowMin >= block.startMin && nowMin < block.endMin;
	const minutes = Math.max(warmup, inside ? block.endMin - nowMin : block.endMin - block.startMin);
	const session: BlockSession = { kind: 'block', startedAt: now, minutes, warmupMin: warmup, day: at.day, block };
	await save(vault, session);
	return { ok: true, session };
}

/** What a study session is made of, once the study module has found it. */
export type StudyPlan = Pick<StudySession, 'names' | 'step' | 'day' | 'minutes'> & { block: Block | null };

/**
 * Start a study session for `subject`. The same rules as `startBlockSession`
 * otherwise: answers the session already running when it is this subject's,
 * refuses `busy` for any other, and writes only the state file.
 *
 * `plan` is called only when nothing is running, because finding the step and
 * block is the study module's work and pointless (or impossible, if the step
 * is done) while a session runs. It returns the plan or its own refusal.
 * `plan.minutes` is raised to the warm-up if it is shorter.
 */
export async function startStudySession(
	vault: Vault,
	subject: { slug: string; name: string },
	plan: () => Promise<StudyPlan | Refused>,
	now: number,
	warmupMin?: number
): Promise<{ ok: true; session: StudySession } | Refused> {
	const running = await readSession(vault);
	if (running) return running.kind === 'study' && running.subject === subject.slug ? { ok: true, session: running } : busy(running);
	const planned = await plan();
	if ('ok' in planned) return planned;
	const warmup = warmupOf(warmupMin);
	const session: StudySession = { kind: 'study', subject: subject.slug, name: subject.name, ...planned, block: planned.block && { raw: planned.block.raw, line: planned.block.line, startMin: planned.block.startMin, endMin: planned.block.endMin, text: textOf(planned.block.raw) }, minutes: Math.max(warmup, planned.minutes), warmupMin: warmup, startedAt: now };
	await save(vault, session);
	return { ok: true, session };
}

/**
 * Add `minutes` to the running session and, when its block has a time range,
 * move that block's end later by the same, through the ordinary guarded task
 * edit. A block that cannot be moved (its line changed, or it has no times)
 * leaves the timer extended and the note alone. Refuses `no-session` when
 * none is running.
 */
export async function extendSession(vault: Vault, minutes: number): Promise<{ ok: true; session: Session } | Refused> {
	const session = await readSession(vault);
	if (!session) return refused('no-session', 'No session is running.');
	session.minutes += minutes;
	const b = session.block;
	if (b && b.startMin !== null && b.endMin !== null) {
		const note = await vault.read(dailyNotePath(session.day));
		const found = note.exists ? locate(note.content, b) : null;
		if (found) {
			const end = Math.min(1440, b.endMin + minutes);
			const moved = await updateTask(vault, dailyNotePath(session.day), found.line, found.raw, { time: { start: formatMinutes(b.startMin), end: formatMinutes(end) } });
			if (moved.ok) session.block = { ...b, raw: moved.task.raw, line: found.line, endMin: end };
		}
	}
	await save(vault, session);
	return { ok: true, session };
}

/** What ending a session did. */
export interface Ended {
	ok: true;
	minutes: number;
	outcome: Outcome;
	/** Parts that could not be written, in words. The outcome itself is never lost to them. */
	warnings: string[];
}

/**
 * End the running session with `outcome` and the scratch `note`.
 *
 * - `done` ticks the block, and a study session's step in `Goals.md`.
 * - `progress` ticks the block only.
 * - `skipped` ticks nothing.
 *
 * A block gets one sub-bullet under it whatever the outcome, so a block that
 * was dealt with, even skipped, stops being offered. The bullet reads
 * `Focus: <block text>, 25m, progress` for a block session and
 * `<Subject>: <step>, 25m, progress` for a study one. A study session with
 * no block appends a ticked one to the day's tasks with the real start and
 * end time (and, skipped, writes nothing); a block session whose block has
 * gone from the note warns and writes nothing. Then the state file is removed.
 * Refuses `no-session` when none is running.
 */
export async function endSession(vault: Vault, outcome: Outcome, note: string, now: number): Promise<Ended | Refused> {
	const session = await readSession(vault);
	if (!session) return refused('no-session', 'No session is running.');
	const warnings: string[] = [];
	const minutes = Math.max(1, Math.round((now - session.startedAt) / 60_000));

	if (session.kind === 'study' && outcome === 'done') {
		const ticked = await updateTask(vault, session.step.path, session.step.line, session.step.raw, { status: 'done' });
		if (!ticked.ok) warnings.push('The step moved in Goals.md, so it was not ticked. Tick it there.');
	}

	const bullet = session.kind === 'study' ? outcomeLine(session.name, session.step.text, minutes, outcome, note) : outcomeLine(FOCUS_LABEL, session.block.text, minutes, outcome, note);
	const startedAt = new Date(session.startedAt);
	const startMin = startedAt.getHours() * 60 + startedAt.getMinutes();
	const path = dailyNotePath(session.day);
	if (!(await vault.read(path)).exists) {
		warnings.push("Today's note does not exist, so nothing was logged in it.");
	} else {
		const wrote: Written = await rewrite(
			vault,
			path,
			(content) => {
				const block = (session.block && locate(content, session.block)) || (session.kind === 'study' ? blockFor(content, session.names) : null);
				if (block) return withBullet(outcome === 'skipped' ? content : tickLine(content, block.line), block, bullet);
				if (session.kind === 'block') return null;
				if (outcome === 'skipped') return null;
				const raw = `- [x] ${formatMinutes(startMin)} - ${formatMinutes(Math.min(1440, startMin + minutes))} Study ${session.name} ${QUADRANT}`;
				const added = appendUnderHeading(content, config.dailyNote.tasksHeading, raw);
				return withBullet(added.content, { blockEnd: added.line, raw }, bullet);
			},
			3,
			{ unchanged: 'nothing to log' }
		);
		// Invalid means the change found nothing to do: fine for a skipped study session, not for a block.
		if (!wrote.ok) {
			if (wrote.reason !== 'invalid') warnings.push(wrote.message);
			else if (session.kind === 'block') warnings.push('The block is not in the note any more, so nothing was logged.');
		}
	}

	await vault.remove(STATE);
	return { ok: true, minutes, outcome, warnings };
}

/** `content` with the task on `line` ticked, every other byte as it was. */
function tickLine(content: string, line: number): string {
	const lines = content.split('\n');
	if (!parseTaskLine(lines[line] ?? '', line)) return content;
	lines[line] = rewriteTaskLine(lines[line], { status: 'done' });
	return lines.join('\n');
}

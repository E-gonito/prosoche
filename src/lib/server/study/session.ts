/**
 * A study session: one subject, its one step, a timer, and what came of it.
 *
 * A session starts from a subject's page (or Today's card) and is kept in
 * `_hub/.state/study-session.json`, which git sync never offers for commit, so
 * closing the tab or opening it on another device finds it still running. Only
 * one runs at a time. Its outcome is the single thing written to the vault: a
 * sub-bullet under the day's block in the daily note (see `block.ts`), a tick
 * on that block, and, when the author said Done, a tick on the step in
 * `Goals.md`. There is no session log file.
 *
 * Every write here is a guarded one-line edit or an insertion; nothing
 * re-serialises a note. A write that clashes is retried against what is there
 * now, and a part that cannot be made (the step's line moved, today's note
 * does not exist) is reported in `warnings` rather than failing the outcome.
 */

import { config } from '../config';
import { dailyNotePath, type DayKey } from '../daily';
import { parseTaskLine, rewriteTaskLine, scanTasks } from '../parse/task';
import { rewrite, type Written } from '../rewrite';
import { appendUnderHeading } from '../sections';
import { updateTask } from '../tasks';
import { blockFor, blockMinutes, loggedSessions, outcomeLine, withBullet, type Block } from './block';
import { focusOn, type studySummary } from './summary';
import type { Subject } from './subjects';
import type { Outcome } from '$lib/shared/study';
import { addDays, formatMinutes } from '$lib/shared/time';
import type { Vault } from '../vault/index';

const STATE = `${config.hubFolder}/.state/study-session.json`;

/** The quadrant a session's block is written with when none existed: important, never urgent. */
const QUADRANT = '`Q2`';

/** A running session. Plain data, so it round-trips through the state file. */
export interface Session {
	subject: string;
	name: string;
	/** Epoch milliseconds the timer started. */
	startedAt: number;
	/** Planned length; "+15 min" adds to it. */
	minutes: number;
	/** The day the session started, which is the day's note it is logged in. */
	day: DayKey;
	step: { path: string; line: number; raw: string; text: string; first: string | null; est: string | null };
	/** The daily-note block it belongs to, or null when it was started without one. */
	block: { raw: string; startMin: number | null; endMin: number | null } | null;
}

type Refused = { ok: false; reason: string; message: string };

const refused = (reason: string, message: string): Refused => ({ ok: false, reason, message });

/** The running session, or null. A missing or unreadable state file means none is running. */
export async function readSession(vault: Vault): Promise<Session | null> {
	const note = await vault.read(STATE);
	if (!note.exists) return null;
	try {
		const s = JSON.parse(note.content) as Session;
		return s && typeof s.startedAt === 'number' && s.step ? s : null;
	} catch {
		return null;
	}
}

const names = (subject: Subject) => [subject.name, ...subject.aliases];

/**
 * Start a session on `subject`: its active goal's first open step, for the
 * length of today's block for it, or `DEFAULT_MINUTES` when it has none.
 *
 * Answers the session already running when it is this subject's (starting
 * twice is harmless), and refuses `busy` for another subject's, `no-step` for
 * a subject with nothing open. Writes only the state file.
 */
export async function startSession(
	vault: Vault,
	subject: Subject,
	summary: Awaited<ReturnType<typeof studySummary>>,
	day: DayKey,
	now: number
): Promise<{ ok: true; session: Session } | Refused> {
	const running = await readSession(vault);
	if (running) {
		return running.subject === subject.slug
			? { ok: true, session: running }
			: refused('busy', `Finish the ${running.name} session first.`);
	}
	const focus = focusOn(summary, day);
	const step = focus?.steps.find((s) => s.state === 'now');
	if (!focus || !step) return refused('no-step', 'This subject has no open step. Add one in Plan.');

	const note = await vault.read(dailyNotePath(day));
	const block = note.exists ? blockFor(note.content, names(subject)) : null;
	const session: Session = {
		subject: subject.slug,
		name: subject.name,
		startedAt: now,
		minutes: blockMinutes(block),
		day,
		step: { path: step.task.path, line: step.task.line, raw: step.task.raw, text: step.task.text, first: step.details.first, est: step.details.est },
		block: block ? { raw: block.raw, startMin: block.startMin, endMin: block.endMin } : null
	};
	await vault.write(STATE, JSON.stringify(session, null, 2) + '\n');
	return { ok: true, session };
}

/**
 * Add `minutes` to the running session and, when its block has a time range,
 * move that block's end later by the same, through the ordinary guarded task
 * edit. A block that cannot be moved (its line changed, or it has no times)
 * leaves the timer extended and the note alone.
 */
export async function extendSession(vault: Vault, minutes: number): Promise<{ ok: true; session: Session } | Refused> {
	const session = await readSession(vault);
	if (!session) return refused('no-session', 'No session is running.');
	session.minutes += minutes;
	const b = session.block;
	if (b && b.startMin !== null && b.endMin !== null) {
		const found = await findBlock(vault, session);
		if (found) {
			const end = Math.min(1440, b.endMin + minutes);
			const moved = await updateTask(vault, dailyNotePath(session.day), found.line, found.raw, {
				time: { start: formatMinutes(b.startMin), end: formatMinutes(end) }
			});
			if (moved.ok) session.block = { raw: moved.task.raw, startMin: b.startMin, endMin: end };
		}
	}
	await vault.write(STATE, JSON.stringify(session, null, 2) + '\n');
	return { ok: true, session };
}

/** Where the session's block is in its day's note now: by its words, else by the subject's name. */
async function findBlock(vault: Vault, session: Session, subject?: string[]): Promise<Block | null> {
	const note = await vault.read(dailyNotePath(session.day));
	if (!note.exists) return null;
	if (session.block) {
		const same = scanTasks(note.content).find((t) => t.raw === session.block!.raw && !t.fenced);
		if (same) return { line: same.line, blockEnd: same.blockEnd, raw: same.raw, startMin: session.block.startMin, endMin: session.block.endMin };
	}
	return subject ? blockFor(note.content, subject) : null;
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
 * - `done` ticks the step in `Goals.md` and the day's block.
 * - `progress` ticks the block only.
 * - `skipped` ticks nothing, and writes nothing at all when there was no block.
 *
 * Either of the first two with no block appends a ticked one to today's tasks,
 * with the real start and end times. The sub-bullet goes under the block in
 * every case but that last. Then the state file is removed. Refuses
 * `no-session` when none is running.
 */
export async function endSession(vault: Vault, subject: Subject, outcome: Outcome, note: string, now: number): Promise<Ended | Refused> {
	const session = await readSession(vault);
	if (!session) return refused('no-session', 'No session is running.');
	const warnings: string[] = [];
	const minutes = Math.max(1, Math.round((now - session.startedAt) / 60_000));

	if (outcome === 'done') {
		const ticked = await updateTask(vault, session.step.path, session.step.line, session.step.raw, { status: 'done' });
		if (!ticked.ok) warnings.push('The step moved in Goals.md, so it was not ticked. Tick it there.');
	}

	const bullet = outcomeLine(session.name, session.step.text, minutes, outcome, note);
	const startedAt = new Date(session.startedAt);
	const startMin = startedAt.getHours() * 60 + startedAt.getMinutes();
	const path = dailyNotePath(session.day);
	let wrote: Written | null = null;
	if (!(await vault.read(path)).exists) {
		warnings.push("Today's note does not exist, so nothing was logged in it.");
	} else {
		wrote = await rewrite(
			vault,
			path,
			(content) => {
				const block = blockIn(content, session, names(subject));
				if (block) {
					const ticked = outcome === 'skipped' ? content : tickLine(content, block.line);
					return withBullet(ticked, block, bullet);
				}
				if (outcome === 'skipped') return null;
				const raw = `- [x] ${formatMinutes(startMin)} - ${formatMinutes(Math.min(1440, startMin + minutes))} Study ${session.name} ${QUADRANT}`;
				const added = appendUnderHeading(content, config.dailyNote.tasksHeading, raw);
				return withBullet(added.content, { blockEnd: added.line, raw }, bullet);
			},
			3,
			{ unchanged: 'nothing to log' }
		);
		if (!wrote.ok && wrote.reason !== 'invalid') warnings.push(wrote.message);
	}

	await vault.remove(STATE);
	return { ok: true, minutes, outcome, warnings };
}

/** The session's block in `content`: the line it was last seen as, else the subject's first open one. */
function blockIn(content: string, session: Session, subjectNames: string[]): Block | null {
	if (session.block) {
		const same = scanTasks(content).find((t) => t.raw === session.block!.raw && !t.fenced);
		if (same) return { line: same.line, blockEnd: same.blockEnd, raw: same.raw, startMin: session.block.startMin, endMin: session.block.endMin };
	}
	return blockFor(content, subjectNames);
}

/** `content` with the task on `line` ticked, every other byte as it was. */
function tickLine(content: string, line: number): string {
	const lines = content.split('\n');
	if (!parseTaskLine(lines[line] ?? '', line)) return content;
	lines[line] = rewriteTaskLine(lines[line], { status: 'done' });
	return lines.join('\n');
}

/** This week's finished sessions for a subject: the seven days ending `day`. Skipped ones do not count. */
export async function weekOf(vault: Vault, subject: Subject, day: DayKey): Promise<{ sessions: number; minutes: number }> {
	let sessions = 0;
	let minutes = 0;
	for (let i = 0; i < 7; i++) {
		const note = await vault.read(dailyNotePath(addDays(day, -i)));
		for (const s of loggedSessions(note.content)) {
			if (s.subject === subject.name && s.outcome !== 'skipped') {
				sessions++;
				minutes += s.minutes;
			}
		}
	}
	return { sessions, minutes };
}

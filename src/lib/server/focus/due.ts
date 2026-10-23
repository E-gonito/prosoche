/**
 * Which block of the day is soon, due or owed a nudge, from the note's text.
 *
 * Everything here is pure: the day's note, the minute now and the raws of
 * blocks already started go in; a strip or a list of nudges comes out. There
 * is no clock, no I/O and no state. The caller owns the clock, the running
 * session and the record of what it has already sent (`nudgesOwed` is
 * idempotent per `key`).
 *
 * A block COUNTS when it is open (todo, in progress or blocked), has both a
 * start and an end time, and is outside a code fence, however short. Blocks
 * are NOT in time order in a real note, they overlap, and two can start at
 * the same minute, so blocks are grouped by identical start minute (a
 * "same-start group", in file order) and everything is decided per group.
 *
 * A block is STARTED when its `raw` is in the caller's `startedRaws`, or it
 * already carries a logged-session sub-bullet. One started block in a group
 * makes the whole group started: the group shares one strip and one nudge, so
 * starting any of them answers all. Started groups are never shown or nudged.
 * (Two lines with identical text in one note are the same `raw`; starting one
 * starts both.)
 *
 * The task-line grammar stays in `parse/task.ts`; this file never reads a line.
 */

import { scanTasks } from '../parse/task';
import { OPEN_STATUSES } from '$lib/shared/task';
import { hasLoggedSession, toBlock } from '../study/block';

/** Lead times and grace, all in minutes. */
export interface DueRules {
	/** The strip is "soon" from this long before a start. */
	soonMin: number;
	/** The strip is "due" from the start until this long after it (or the block's end, if sooner). */
	dueForMin: number;
	/** The wind-down nudge goes this long before a start. */
	windDownMin: number;
	/** The follow-up nudge goes this long after a start. */
	followUpMin: number;
	/** A nudge is still owed this long after its moment; later than that it is dropped. */
	lateGraceMin: number;
}

export const DEFAULT_RULES: DueRules = { soonMin: 15, dueForMin: 30, windDownMin: 10, followUpMin: 10, lateGraceMin: 3 };

/** One counted block. Minutes are since midnight; `endMin` may be 1440 for `24:00`. */
export interface DueBlock {
	/** 0-based line of the task in the note. */
	line: number;
	/** Last line of the task and its sub-bullets. */
	blockEnd: number;
	/** The line exactly as in the note; identifies the block to the caller. */
	raw: string;
	/** The task's words without times or quadrant, as displayed. */
	text: string;
	startMin: number;
	endMin: number;
}

/** What the now strip shows: blocks sharing one start minute, `soon` before it, `due` after it. */
export type Strip = { state: 'soon' | 'due'; startMin: number; blocks: DueBlock[] };

export type NudgeKind = 'wind-down' | 'start' | 'follow-up';

/** A nudge that should go out now. */
export interface Nudge {
	kind: NudgeKind;
	/** Stable across restarts and calls: kind, start minute and the group's raws. The caller dedupes on it. */
	key: string;
	startMin: number;
	/** The same-start group, in file order. */
	blocks: DueBlock[];
}

interface Group {
	startMin: number;
	blocks: DueBlock[];
	started: boolean;
}

/** Counted blocks grouped by start minute, ascending, each group's blocks in file order. Pure. */
function groups(content: string, startedRaws: string[]): Group[] {
	const byStart = new Map<number, Group>();
	for (const t of scanTasks(content)) {
		if (t.fenced || !OPEN_STATUSES.includes(t.status)) continue;
		const b = toBlock(t);
		if (b.startMin === null || b.endMin === null) continue;
		const g = byStart.get(b.startMin) ?? { startMin: b.startMin, blocks: [], started: false };
		g.blocks.push({ line: b.line, blockEnd: b.blockEnd, raw: b.raw, text: t.text, startMin: b.startMin, endMin: b.endMin });
		if (startedRaws.includes(b.raw) || hasLoggedSession(content, b)) g.started = true;
		byStart.set(b.startMin, g);
	}
	return [...byStart.values()].sort((a, b) => a.startMin - b.startMin);
}

/**
 * True when the note has at least one timed block outside a code fence,
 * whatever its state: a day whose blocks are all ticked or skipped was still
 * planned. Pure.
 */
export function hasPlan(content: string): boolean {
	return scanTasks(content).some((t) => !t.fenced && t.start !== null && t.end !== null);
}

/**
 * The strip to show at `nowMin`, or null for none. Considers only not-started
 * groups. A group is DUE when `start <= now < min(latest end, start + dueFor)`
 * (a group runs until its longest block ends), SOON when
 * `start - soon <= now < start`. When several are due the one that started
 * most recently wins, so a long block steps aside for a shorter one inside it;
 * otherwise the soonest upcoming group is returned. Pure.
 */
export function stripFor(content: string, nowMin: number, startedRaws: string[], rules: DueRules = DEFAULT_RULES): Strip | null {
	const open = groups(content, startedRaws).filter((g) => !g.started);
	const due = open.filter((g) => g.startMin <= nowMin && nowMin < Math.min(latestEnd(g), g.startMin + rules.dueForMin));
	if (due.length) {
		const g = due[due.length - 1];
		return { state: 'due', startMin: g.startMin, blocks: g.blocks };
	}
	const soon = open.find((g) => g.startMin - rules.soonMin <= nowMin && nowMin < g.startMin);
	return soon ? { state: 'soon', startMin: soon.startMin, blocks: soon.blocks } : null;
}

/**
 * The nudges to send at `nowMin`. Per not-started group: wind-down at
 * `start - windDown`, start at `start`, follow-up at `start + followUp`. A
 * nudge is owed when `at <= now <= at + lateGrace`: a late nudge is worse than
 * none, so one missed by more than the grace is gone for good. No nudge has
 * `at < 0` (nothing crosses into yesterday), and the follow-up is skipped when
 * `at` is not before the group's latest end. Ordered by start minute, then
 * wind-down, start, follow-up. Called every 30 seconds, so the same nudge is
 * returned repeatedly while it is owed; the caller dedupes on `key`. Pure.
 */
export function nudgesOwed(content: string, nowMin: number, startedRaws: string[], rules: DueRules = DEFAULT_RULES): Nudge[] {
	const out: Nudge[] = [];
	for (const g of groups(content, startedRaws)) {
		if (g.started) continue;
		const moments: [NudgeKind, number][] = [
			['wind-down', g.startMin - rules.windDownMin],
			['start', g.startMin],
			['follow-up', g.startMin + rules.followUpMin]
		];
		for (const [kind, at] of moments) {
			if (at < 0 || nowMin < at || nowMin > at + rules.lateGraceMin) continue;
			if (kind === 'follow-up' && at >= latestEnd(g)) continue;
			out.push({ kind, key: `${kind}:${g.startMin}:${hash(g.blocks.map((b) => b.raw).join('\n'))}`, startMin: g.startMin, blocks: g.blocks });
		}
	}
	return out;
}

const latestEnd = (g: Group) => Math.max(...g.blocks.map((b) => b.endMin));

/** FNV-1a of `s` as 8 hex digits: deterministic across processes, unlike anything seeded. Pure. */
function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

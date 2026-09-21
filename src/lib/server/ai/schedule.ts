/**
 * The jobs that run on a clock rather than on a click.
 *
 * There are two, and both are small: the morning briefing each day, and the
 * weekly review each Sunday evening. They live together because the awkward
 * part is not either job, it is the scheduling — and doing that twice in two
 * files is how the two copies come to disagree about what "missed" means.
 *
 * ## Why not cron
 *
 * The app already runs as a long-lived process under systemd, and a cron
 * entry would need its own way in: an HTTP call with a token, or a second
 * process with its own copy of the config. A timer inside the process that is
 * already holding the vault and the index is one moving part instead of three.
 *
 * ## What "missed" means
 *
 * A laptop that was asleep at 07:00 and opened at 09:20 should still get its
 * briefing, because the point of it is the day it describes and 09:20 is
 * still that day. So the schedule records what it has run in `_hub/.state/`
 * and, on every tick, runs anything whose time has passed today and which
 * has not run yet. A machine that is off all day runs nothing and records
 * nothing, and the next morning is unaffected.
 *
 * That file is the only state here, it is in the transient list so it is
 * never committed, and losing it costs one duplicate run of a job that is
 * itself idempotent — the briefing rewrites its own region either way.
 */

import { config } from '../config';
import { today, type DayKey } from '../daily';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import { loadSettings } from './settings';
import { run as runBriefing } from './briefing';
import { run as runWeeklyReview } from './weekly-review';

/** Where the last-run stamps live. Transient: not committed, safe to lose. */
export const STATE_PATH = `${config.hubFolder}/.state/schedule.json`;

/** How often the timer wakes. Fine-grained enough that a 07:00 job is not 07:55. */
const TICK_MS = 5 * 60 * 1000;

export interface Job {
	id: string;
	/** Minutes past midnight, local time. */
	atMin: number;
	/** 0 is Sunday. Absent means every day. */
	onWeekday?: number;
	run: (deps: JobDeps, day: DayKey) => Promise<void>;
}

export interface JobDeps {
	vault: Vault;
	index: NoteIndex;
}

export const JOBS: Job[] = [
	{
		id: 'briefing',
		atMin: 7 * 60,
		run: async (deps, day) => {
			await runBriefing(deps, day);
		}
	},
	{
		id: 'weekly-review',
		atMin: 18 * 60,
		onWeekday: 0,
		run: async (deps, day) => {
			await runWeeklyReview(deps, day);
		}
	}
];

/**
 * Which jobs should have run by now and have not.
 *
 * Inputs: the jobs, the moment, and what the state file says was last run.
 * Output: the jobs to run, in the order they are listed. Side effects: none —
 * pure, which is what lets "a laptop opened at 09:20 still gets its briefing"
 * be a test rather than a hope.
 *
 * Never returns a job twice for the same day, and never returns one whose
 * time has not arrived. A clock moved backwards is treated as the earlier
 * time, so nothing runs twice; a clock moved forwards runs what it skipped.
 */
export function due(jobs: Job[], now: Date, lastRun: Record<string, string>): Job[] {
	const day = today(now);
	const minutes = now.getHours() * 60 + now.getMinutes();
	return jobs.filter((job) => {
		if (job.onWeekday !== undefined && now.getDay() !== job.onWeekday) return false;
		if (minutes < job.atMin) return false;
		return lastRun[job.id] !== day;
	});
}

/**
 * Start the timer. Returns a function that stops it.
 *
 * Inputs: the vault and index, and optionally a different job list or clock
 * for tests. Output: a stop function. Side effects: a repeating timer, and
 * whatever the jobs themselves write.
 *
 * Never runs a job while the kill switch is off, checked on each tick rather
 * than at startup, so turning AI off in the settings page takes effect
 * without a restart. Never lets one job's failure stop another's, and never
 * lets either take the process down: a scheduled job that throws is logged
 * and its stamp is still written, because a job that fails every five minutes
 * for a day is worse than one that fails once.
 */
export function startSchedule(
	deps: JobDeps,
	options: { jobs?: Job[]; intervalMs?: number } = {}
): () => void {
	const jobs = options.jobs ?? JOBS;
	const timer = setInterval(() => void tick(deps, jobs), options.intervalMs ?? TICK_MS);
	timer.unref?.();
	void tick(deps, jobs);
	return () => clearInterval(timer);
}

/** One pass. Exported so a test can drive it without waiting five minutes. */
export async function tick(deps: JobDeps, jobs: Job[] = JOBS, now = new Date()): Promise<string[]> {
	const settings = await loadSettings(deps.vault);
	if (!settings.enabled) return [];

	const state = await readState(deps.vault);
	const ran: string[] = [];
	for (const job of due(jobs, now, state)) {
		state[job.id] = today(now);
		try {
			await job.run(deps, today(now));
			ran.push(job.id);
		} catch (e) {
			console.error(`[schedule] ${job.id} failed`, e);
		}
		await writeState(deps.vault, state);
	}
	return ran;
}

async function readState(vault: Vault): Promise<Record<string, string>> {
	const note = await vault.read(STATE_PATH);
	if (!note.exists) return {};
	try {
		const parsed = JSON.parse(note.content) as Record<string, string>;
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		// A half-written file means one duplicate run, which both jobs survive.
		return {};
	}
}

async function writeState(vault: Vault, state: Record<string, string>): Promise<void> {
	const note = await vault.read(STATE_PATH);
	await vault.write(STATE_PATH, `${JSON.stringify(state, null, '\t')}\n`, note.exists ? note.hash : undefined);
}

/**
 * The nudge loop: what reaches the author's phone, and when.
 *
 * Every 30 seconds `nudgeTick` asks `due.ts` which nudges are owed to today's
 * note, sends the ones it has not sent, and remembers them. Three nudges per
 * block, then silence, plus one "Today has no plan yet" push (decisions 5 to 7
 * in `docs/plan-start.md`). The words and links live here; how a push is sent
 * is `notify.ts`'s, and which nudges are owed is `due.ts`'s.
 *
 * What was sent lives in `_hub/.state/nudges.json` as `{ day, sent }`, so a
 * restart never repeats a nudge. A new day starts the list again, which keeps
 * the file to one day's keys. The file is transient state, as `.state/` is.
 *
 * A key is recorded BEFORE its push is attempted and is never removed: a push
 * that fails is not retried (a late nudge is worse than none), and a crash
 * between recording and sending loses one nudge rather than doubling it. Only
 * one running copy of the server may exist, or each of them sends.
 */

import { config, type PushConfig } from '../config';
import { dailyNotePath, today } from '../daily';
import { pushStatus, send, type Notification, type Sender } from '../notify';
import type { Vault } from '../vault/index';
import { focusSettings } from './settings';
import { hasPlan, nudgesOwed, type Nudge } from './due';
import { readSession, startedRaws } from './session';
import { justMinutes } from '$lib/shared/focus';

const STATE = `${config.hubFolder}/.state/nudges.json`;

/** How often the loop looks. Must stay well under `DueRules.lateGraceMin`, or a nudge can fall between two looks. */
const TICK_MS = 30_000;

/** The first look after boot, so a restart mid-window does not wait a whole interval. */
const FIRST_TICK_MS = 5_000;

/** The key of the one "no plan" push; there is at most one a day. */
const NO_PLAN_KEY = 'no-plan';

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * The push for a nudge. `day` is the note's day and `windDownMin` and
 * `warmupMin` the current settings, whose numbers the wording repeats. The
 * title names the block (`A, B` for blocks starting together); a single block
 * links to its start screen, a group to Today where the author picks. The tag
 * is per start minute so a newer nudge for the same block replaces the older
 * one on the device. Pure.
 */
export function composeNudge(nudge: Nudge, day: string, windDownMin: number, warmupMin: number): Notification {
	const what = nudge.blocks.map((b) => b.text).join(', ');
	const url = nudge.blocks.length === 1 ? `/focus/start?day=${day}&line=${nudge.blocks[0].line}` : '/today';
	const tag = `focus-${nudge.startMin}`;
	switch (nudge.kind) {
		case 'wind-down':
			return { title: `${what} at ${hhmm(nudge.startMin)}`, body: `Finish this match. It starts in ${windDownMin} min.`, url, tag };
		case 'start':
			return { title: `${what} now`, body: `${justMinutes(warmupMin)}.`, url, tag };
		case 'follow-up':
			return { title: `${what} hasn't started`, body: 'Start, or let it go.', url, tag };
	}
}

/** The push for a day that has no timed block by the "plan by" time. Pure. */
export function composeNoPlan(): Notification {
	return { title: 'Today has no plan yet', body: 'Open Today and time-block it.', url: '/today', tag: 'focus-no-plan' };
}

/** What was sent today. A missing, unreadable or other-day file reads as nothing sent. */
async function readSent(vault: Vault, day: string): Promise<{ sent: string[]; hash?: string }> {
	const note = await vault.read(STATE);
	if (!note.exists) return { sent: [] };
	try {
		const parsed: unknown = JSON.parse(note.content);
		const state = parsed as { day?: unknown; sent?: unknown } | null;
		const sent = state?.day === day && Array.isArray(state.sent) ? state.sent.filter((k): k is string => typeof k === 'string') : [];
		return { sent, hash: note.hash };
	} catch (e) {
		console.error(`[nudge] ${STATE} is not valid JSON; treating it as nothing sent`, e);
		return { sent: [], hash: note.hash };
	}
}

/**
 * One pass of the loop.
 *
 * Inputs: the vault, the instant to judge (`now`, in the server's timezone),
 * and for tests a push `sender` and a `push` config, which default to
 * web-push and the process's. Output: the keys it sent this pass, in order
 * (`[]` for none), so a test can see what happened.
 *
 * Reads the settings, today's note (a missing one is empty) and the running
 * session; sends every nudge `due.ts` owes that is not recorded for today,
 * and the no-plan push when it is owed. Nothing is sent for a block that has a
 * running session, a logged session or a tick. Does nothing, and records
 * nothing, while push is not configured.
 *
 * Side effects: pushes, and one write to `_hub/.state/nudges.json` when
 * anything is owed. Throws if that file cannot be written (nothing is sent
 * then, so a stuck disk cannot cause a stream of repeats); a failed push is
 * logged by `notify.ts`, recorded, and not retried.
 */
export async function nudgeTick(vault: Vault, now: Date, sender?: Sender, push: PushConfig = config.push): Promise<string[]> {
	if (!pushStatus(push).configured) return [];

	const day = today(now);
	const nowMin = now.getHours() * 60 + now.getMinutes();
	const [settings, note, session] = await Promise.all([focusSettings(vault), vault.read(dailyNotePath(day)), readSession(vault)]);
	const content = note.exists ? note.content : '';

	const owed: Array<{ key: string; message: Notification }> = nudgesOwed(content, nowMin, startedRaws(session), settings.rules).map((n) => ({
		key: n.key,
		message: composeNudge(n, day, settings.rules.windDownMin, settings.warmupMin)
	}));
	if (settings.planByMin <= nowMin && nowMin <= settings.planByMin + settings.rules.lateGraceMin && !hasPlan(content)) {
		owed.push({ key: NO_PLAN_KEY, message: composeNoPlan() });
	}
	if (!owed.length) return [];

	const { sent, hash } = await readSent(vault, day);
	const fresh = owed.filter((o) => !sent.includes(o.key));
	if (!fresh.length) return [];

	const written = await vault.write(STATE, JSON.stringify({ day, sent: [...sent, ...fresh.map((o) => o.key)] }) + '\n', hash);
	if (!written.ok) throw new Error(`could not record sent nudges in ${STATE}: it changed underneath`);

	for (const { key, message } of fresh) {
		const result = await send(vault, message, sender);
		console.log(`[nudge] ${key}: sent ${result.sent}, failed ${result.failed}, removed ${result.removed}`);
	}
	return fresh.map((o) => o.key);
}

/**
 * Run `nudgeTick` every 30 seconds, and once shortly after this call.
 *
 * Output: a function that stops the loop (idempotent; a pass already under
 * way finishes). Passes never overlap: a pass still running when the next is
 * due makes that one skip. A pass that throws is logged with a `[nudge]`
 * prefix and the loop carries on. The timers do not keep the process alive.
 */
export function startNudges(vault: Vault): () => void {
	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await nudgeTick(vault, new Date());
		} catch (e) {
			console.error('[nudge] tick failed', e);
		} finally {
			running = false;
		}
	};
	const first = setTimeout(() => void tick(), FIRST_TICK_MS);
	const every = setInterval(() => void tick(), TICK_MS);
	first.unref();
	every.unref();
	return () => {
		clearTimeout(first);
		clearInterval(every);
	};
}

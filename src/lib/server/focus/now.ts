/**
 * What the now strip shows right now, decided on the server from the vault.
 *
 * One function, one answer: the running session if there is one (on any day,
 * for any block or subject), else the soon or due strip for today's note, else
 * nothing. The server's clock and time zone decide what a block time means;
 * the browser only counts down from what is returned here (`serverNow` and
 * `startAt` let it ignore its own clock and zone).
 */

import { dailyNotePath, today } from '../daily';
import { stripFor } from './due';
import { readSession, sessionName, startedRaws } from './session';
import { focusSettings } from './settings';
import type { NowStrip } from '$lib/shared/focus-now';
import type { Vault } from '../vault/index';

/**
 * The strip for `now`, or null for none.
 *
 * Running wins over everything, so a due block never shows while one is being
 * done. Otherwise `stripFor` runs over today's note with the lead times from
 * the focus settings; the note's blocks are not "started" by anything but a
 * logged sub-bullet, since no session is running. A missing note, a note with
 * no counted block, or a quiet moment is null. Read-only, apart from the
 * one-time move of an old study-session file that `readSession` does.
 */
export async function nowStrip(vault: Vault, now: Date): Promise<NowStrip | null> {
	const serverNow = now.getTime();
	const session = await readSession(vault);
	if (session) {
		return { state: 'running', name: sessionName(session), startedAt: session.startedAt, minutes: session.minutes, warmupMin: session.warmupMin, serverNow };
	}
	const day = today(now);
	const note = await vault.read(dailyNotePath(day));
	if (!note.exists) return null;
	const { rules } = await focusSettings(vault);
	const nowMin = now.getHours() * 60 + now.getMinutes();
	const strip = stripFor(note.content, nowMin, startedRaws(null), rules);
	if (!strip) return null;
	return {
		state: strip.state,
		day,
		startMin: strip.startMin,
		// Local midnight plus the minutes, so a daylight-saving day still lands on the wall-clock time.
		startAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, strip.startMin).getTime(),
		blocks: strip.blocks.map((b) => ({ line: b.line, text: b.text, startMin: b.startMin, endMin: b.endMin })),
		serverNow
	};
}

/**
 * A study session: the study half of a focus session.
 *
 * What is study's here is finding things: the subject's active step, the
 * subject's block in today's note (and so the session's length), and the week's
 * count read back from the notes. The timer, the state file, extending and the
 * ending itself are `focus/session.ts`'s, which knows nothing of subjects; this
 * module hands it a finished description of the session and checks that the
 * session being ended is this subject's.
 */

import { dailyNotePath, type DayKey } from '../daily';
import { endSession as endFocusSession, readSession, startStudySession, type Ended, type Refused, type StudySession } from '../focus/session';
import { blockFor, blockMinutes, loggedSessions } from './block';
import { focusOn, type studySummary } from './summary';
import type { Subject } from './subjects';
import type { Outcome } from '$lib/shared/study';
import { addDays } from '$lib/shared/time';
import type { Vault } from '../vault/index';

export { extendSession, readSession } from '../focus/session';

const names = (subject: Subject) => [subject.name, ...subject.aliases];

/**
 * Start a session on `subject`: its active goal's first open step, for the
 * length of today's block for it, or `DEFAULT_MINUTES` when it has none.
 * `warmupMin` is passed on to the focus session (its default when omitted).
 *
 * Answers the session already running when it is this subject's (starting
 * twice is harmless), and refuses `busy` for another's, `no-step` for a
 * subject with nothing open. Writes only the state file.
 */
export async function startSession(
	vault: Vault,
	subject: Subject,
	summary: Awaited<ReturnType<typeof studySummary>>,
	day: DayKey,
	now: number,
	warmupMin?: number
): Promise<{ ok: true; session: StudySession } | Refused> {
	return startStudySession(
		vault,
		subject,
		async () => {
			const focus = focusOn(summary, day);
			const step = focus?.steps.find((s) => s.state === 'now');
			if (!focus || !step) return { ok: false, reason: 'no-step', message: 'This subject has no open step. Add one in Plan.' };
			const note = await vault.read(dailyNotePath(day));
			const block = note.exists ? blockFor(note.content, names(subject)) : null;
			return {
				names: names(subject),
				day,
				minutes: blockMinutes(block),
				step: { path: step.task.path, line: step.task.line, raw: step.task.raw, text: step.task.text, first: step.details.first, est: step.details.est },
				block
			};
		},
		now,
		warmupMin
	);
}

/**
 * End the running session, which must be `subject`'s, with `outcome` and the
 * scratch `note`. Refuses `no-session` when none is running or the one running
 * is another subject's, so a stale tab cannot log into the wrong subject. The
 * ticks and the sub-bullet are `focus/session.ts`'s (`endSession`).
 */
export async function endSession(vault: Vault, subject: Subject, outcome: Outcome, note: string, now: number): Promise<Ended | Refused> {
	const running = await readSession(vault);
	if (running?.kind !== 'study' || running.subject !== subject.slug) return { ok: false, reason: 'no-session', message: `No ${subject.name} session is running.` };
	return endFocusSession(vault, outcome, note, now);
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

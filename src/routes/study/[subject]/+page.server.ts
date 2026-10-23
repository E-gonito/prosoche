import { hub } from '$server/hub';
import { blockFor, blockMinutes } from '$server/study/block';
import { dailyNotePath } from '$server/daily';
import { weekOf } from '$server/study/session';
import { readSession, sessionName } from '$server/focus/session';
import type { PageServerLoad } from './$types';

/**
 * What the session card needs beyond the layout's goals: how long today's
 * block for this subject says to study, this week's sessions, and the session
 * running now (a subject's, or a block's with no subject), by name. Never writes.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const [{ subject, today }, { vault }] = await Promise.all([parent(), hub()]);
	const note = await vault.read(dailyNotePath(today));
	const block = note.exists ? blockFor(note.content, [subject.name, ...subject.aliases]) : null;
	const running = await readSession(vault);
	return {
		minutes: blockMinutes(block),
		fromBlock: block !== null && block.startMin !== null,
		week: await weekOf(vault, subject, today),
		running: running && { subject: running.kind === 'study' ? running.subject : null, name: sessionName(running), step: running.kind === 'study' ? running.step.text : null }
	};
};

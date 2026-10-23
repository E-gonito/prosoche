import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { readSession } from '$server/focus/session';
import type { PageServerLoad } from './$types';

/**
 * The running session, whatever block or subject it is for, with the server's
 * clock so the timer is right on a device whose clock is off, the colour of a
 * study session's subject, and where ending goes next: the subject's card for
 * a study session, Today for any other. No session goes to Today. Never writes
 * (bar moving an old study-session file once, see `readSession`).
 */
export const load: PageServerLoad = async () => {
	const { vault, subjects } = await hub();
	const session = await readSession(vault);
	if (!session) redirect(307, '/today');
	const subject = session.kind === 'study' ? (await subjects()).find((s) => s.slug === session.subject) : undefined;
	return { session, serverNow: Date.now(), color: subject?.color ?? null, back: subject ? `/study/${subject.slug}` : '/today' };
};

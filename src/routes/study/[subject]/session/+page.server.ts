import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { readSession } from '$server/study/session';
import type { PageServerLoad } from './$types';

/**
 * The running session for this subject, with the server's clock so the timer
 * is right on a device whose clock is off. No session, or one for another
 * subject, goes back to the card. Never writes.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const [{ subject }, { vault }] = await Promise.all([parent(), hub()]);
	const session = await readSession(vault);
	if (!session || session.subject !== subject.slug) redirect(307, `/study/${subject.slug}`);
	return { session, serverNow: Date.now() };
};

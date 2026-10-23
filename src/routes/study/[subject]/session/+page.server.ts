import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { readSession } from '$server/focus/session';
import type { PageServerLoad } from './$types';

/**
 * The old address of a subject's session, kept so links and bookmarks still
 * work. The session now lives at `/focus`, whatever it is for. This subject's
 * running session, or any other, goes there; with none running it goes back to
 * the subject's card. Never renders, never writes.
 */
export const load: PageServerLoad = async ({ parent }) => {
	const [{ subject }, { vault }] = await Promise.all([parent(), hub()]);
	redirect(307, (await readSession(vault)) ? '/focus' : `/study/${subject.slug}`);
};

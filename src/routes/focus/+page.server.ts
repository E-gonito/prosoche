import { redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { readSession } from '$server/focus/session';
import { studySummary } from '$server/study/summary';
import { listBooks } from '$server/books/library';
import { bookForLink, bookLink, type BookLink } from '$server/books/links';
import type { PageServerLoad } from './$types';

/**
 * The running session, whatever block or subject it is for, with the server's
 * clock so the timer is right on a device whose clock is off, the colour of a
 * study session's subject, and where ending goes next: the subject's card for
 * a study session, Today for any other. No session goes to Today. A study
 * session also gets the book its subject is reading, if any: the first item
 * in the reading list's Reading group that links to a book. Never writes
 * (bar moving an old study-session file once, see `readSession`).
 */
export const load: PageServerLoad = async () => {
	const { vault, shelf, subjects } = await hub();
	const session = await readSession(vault);
	if (!session) redirect(307, '/today');
	const subject = session.kind === 'study' ? (await subjects()).find((s) => s.slug === session.subject) : undefined;
	let book: BookLink | null = null;
	if (subject) {
		const [summary, books] = await Promise.all([studySummary(vault, subject), listBooks(vault, shelf)]);
		const reading = summary.reading.groups.find((g) => g.title.trim().toLowerCase() === 'reading')?.items ?? [];
		const found = reading.map((item) => bookForLink(item.url, books)).find((b) => b !== null);
		book = found ? bookLink(found) : null;
	}
	return { session, serverNow: Date.now(), color: subject?.color ?? null, back: subject ? `/study/${subject.slug}` : '/today', book };
};

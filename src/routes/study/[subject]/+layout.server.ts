import { error, redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { subjectsOf } from '$server/study/subjects';
import type { LayoutServerLoad } from './$types';

/**
 * The old single-subject tab URLs, `/study/goals` and the rest, and the tab
 * each is now under `/study/<subject>`.
 */
const OLD_TABS: Record<string, string> = {
	goals: '/goals',
	sessions: '/sessions',
	resources: '/reading',
	reading: '/reading',
	flashcards: '/flashcards'
};

/**
 * Which subject every page under `/study/<subject>` is about.
 *
 * A subject's slug wins over an old tab URL, so a subject may be called
 * "Goals". Otherwise an old URL goes to that tab of the only subject, or to
 * the Study index when there are several or none; anything else is a 404.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { ready, workspaces } = hub();
	await ready;
	const subjects = subjectsOf(await workspaces());
	const subject = subjects.find((s) => s.slug === params.subject);
	if (subject) return { subject };

	const tab = OLD_TABS[params.subject];
	if (tab !== undefined) redirect(307, subjects.length === 1 ? `/study/${subjects[0].slug}${tab}` : '/study');
	error(404, 'There is no such subject.');
};

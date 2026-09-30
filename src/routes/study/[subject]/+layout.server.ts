import { error, redirect } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { today } from '$server/daily';
import { subjectsOf } from '$server/study/subjects';
import { studySummary, subjectView } from '$server/study/summary';
import { readLede } from '$server/parse/note';
import { noteHref } from '$lib/shared/links';
import type { LayoutServerLoad } from './$types';

/**
 * The old single-subject tab URLs, `/study/goals` and the rest, and the tab
 * each is now under `/study/<subject>`.
 */
const OLD_TABS: Record<string, string> = {
	goals: '/goals',
	sessions: '/sessions',
	resources: '/reading',
	reading: '/reading'
};

/**
 * Which subject every page under `/study/<subject>` is about, what its
 * heading says (the name, description, colour and tag in its workspace
 * file), and what its Overview, Goals, Reading and Sessions tabs show
 * (`subjectView`), read once here so those tabs need no load of their own.
 *
 * A subject's slug wins over an old tab URL, so a subject may be called
 * "Goals". Otherwise an old URL goes to that tab of the only subject, or to
 * the Study index when there are several or none; the old
 * `/study/flashcards` and `/study/review`, from when cards were Study's, go
 * to the Flashcards page; anything else is a 404.
 */
export const load: LayoutServerLoad = async ({ params, url }) => {
	const { vault, workspaces } = await hub();
	const all = await workspaces();
	const subjects = subjectsOf(all);
	const subject = subjects.find((s) => s.slug === params.subject);
	const workspace = all.find((w) => w.slug === params.subject);
	if (subject && workspace) {
		// Read on every tab change, not only when the subject changes: a card
		// graded or a reading item moved on one tab must show on the next, and
		// so must an edit made in Obsidian meanwhile.
		void url.pathname;
		const day = today();
		const definition = await vault.read(workspace.path);
		return {
			subject,
			// What the heading shows and its Edit changes: the subject's workspace file.
			details: { name: workspace.name, description: readLede(definition.content), color: workspace.color, tag: workspace.tag },
			definitionHref: noteHref(workspace.path),
			today: day,
			study: subjectView(await studySummary(vault, subject), day)
		};
	}

	if (params.subject === 'flashcards' || params.subject === 'review') redirect(307, '/flashcards');
	const tab = OLD_TABS[params.subject];
	if (tab !== undefined) redirect(307, subjects.length === 1 ? `/study/${subjects[0].slug}${tab}` : '/study');
	error(404, 'There is no such subject.');
};

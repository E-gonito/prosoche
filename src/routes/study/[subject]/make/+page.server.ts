import { hub } from '$server/hub';
import { loadSettings } from '$server/ai/settings';
import { cardFilePath, sourceNotes } from '$server/study/card-files';
import { goalRefs, readGoals } from '$server/study/goals';
import type { PageServerLoad } from './$types';

/** Recently edited notes offered as one-click picks. */
const RECENT = 8;

/**
 * The Make cards page: the subject's notes and folders to pick from, the
 * most recently edited of them, its goals and the card file each goal's
 * cards go to, and whether AI is on. `?note=<path>` starts with that note
 * picked, when it is one of the subject's; `?goal=<slug>` with that goal.
 * Writes nothing.
 */
export const load: PageServerLoad = async ({ parent, url }) => {
	const { subject } = await parent();
	const { vault, ready } = hub();
	await ready;

	const [{ notes, folders }, goals, settings] = await Promise.all([
		sourceNotes(vault, subject),
		readGoals(vault, subject.files.goals).then(goalRefs),
		loadSettings(vault)
	]);
	const note = url.searchParams.get('note');
	const goal = goals.find((g) => g.slug === url.searchParams.get('goal'))?.name ?? null;

	return {
		aiEnabled: settings.enabled,
		notes: notes.map((n) => ({ path: n.path, title: n.title })),
		recent: [...notes].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, RECENT).map((n) => n.path),
		folders,
		goals,
		/** Keyed by goal name, '' for none: where Add puts the cards. */
		destinations: Object.fromEntries([['', cardFilePath(subject, null)], ...goals.map((g) => [g.name, cardFilePath(subject, g.name)])]) as Record<string, string>,
		picked: notes.some((n) => n.path === note) ? note : null,
		goal
	};
};

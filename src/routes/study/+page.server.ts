import { hub } from '$server/hub';
import { today } from '$server/daily';
import { loadWidgets } from '$server/widgets';
import type { PageServerLoad } from './$types';

/** The dashboard's widgets, in reading order: what is due, then what is next. */
const TABS = ['flashcards-due', 'currently-learning', 'queue', 'habits', 'topic-map'];

/**
 * The study dashboard.
 *
 * Its scope is a workspace, because the widgets are the workspace widgets:
 * `?ws=<slug>` picks one, otherwise the first workspace built from the study
 * template, otherwise the whole vault. So this page is a view of a workspace
 * rather than a second, parallel notion of "study" that could disagree with
 * one.
 */
export const load: PageServerLoad = async ({ url }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const asked = url.searchParams.get('ws');
	const workspace = asked ? (defs.find((w) => w.slug === asked) ?? null) : (defs.find((w) => w.template === 'study') ?? null);

	const day = today();
	const widgets = await loadWidgets(TABS, { vault, index, workspace, workspaces: defs, today: day });

	return {
		today: day,
		widgets,
		workspace: workspace ? { slug: workspace.slug, name: workspace.name, color: workspace.color } : null,
		choices: defs.map((w) => ({ slug: w.slug, name: w.name }))
	};
};

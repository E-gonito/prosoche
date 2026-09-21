/**
 * The widget catalogue: the one list of things a workspace tab can show.
 *
 * A workspace file names widgets by string, so this module is what turns
 * `widgets: [board, blocked]` into data a page can render. Every widget is a
 * module under `widgets/` exporting `load`, which makes adding one a matter of
 * writing a file and naming it here, rather than editing a switch statement
 * that grows forever.
 *
 * A widget that fails to load is reported as a widget with a problem, never as
 * a broken page: one missing folder must not take a workspace down.
 */

import type { NoteIndex } from './index/index';
import type { Vault } from './vault/index';
import type { Workspace } from './workspaces';
import { WIDGETS, type LoadedWidget } from '$lib/shared/widgets';

export type { LoadedWidget };

export interface WidgetContext {
	index: NoteIndex;
	vault: Vault;
	/** The workspace whose tab is being rendered, or null on a global page. */
	workspace: Workspace | null;
	workspaces: Workspace[];
	/** Today as `YYYY-MM-DD`, passed in so widgets stay pure of the clock. */
	today: string;
}

/** What a widget module exports. `data` is serialised straight to the browser. */
export type WidgetLoad = (ctx: WidgetContext) => Promise<unknown>;

type Loader = () => Promise<{ load: WidgetLoad }>;

/** One importer per catalogue entry, so adding a widget is adding a file. */
const LOADERS: Record<string, Loader> = {
	board: () => import('./widgets/board'),
	notes: () => import('./widgets/notes'),
	blocked: () => import('./widgets/blocked'),
	pinned: () => import('./widgets/pinned'),
	inbox: () => import('./widgets/inbox'),
	people: () => import('./widgets/people'),
	time: () => import('./widgets/time'),
	insights: () => import('./widgets/insights'),
	habits: () => import('./widgets/habits'),
	'currently-learning': () => import('./widgets/currently-learning'),
	queue: () => import('./widgets/queue'),
	'topic-map': () => import('./widgets/topic-map'),
	'flashcards-due': () => import('./widgets/flashcards-due'),
	timesheet: () => import('./widgets/timesheet'),
	github: () => import('./widgets/github'),
	linear: () => import('./widgets/linear')
};

/**
 * Load every widget on a tab, in the order the workspace file lists them.
 * Unknown names are dropped: a typo in a workspace file should show fewer
 * widgets, not an error page.
 */
export async function loadWidgets(names: string[], ctx: WidgetContext): Promise<LoadedWidget[]> {
	const wanted = names.filter((name) => name in WIDGETS && name in LOADERS);
	return Promise.all(
		wanted.map(async (name) => {
			const entry = WIDGETS[name];
			try {
				const module = await LOADERS[name]();
				return { name, title: entry.title, span: entry.span, data: await module.load(ctx) };
			} catch (e) {
				return {
					name,
					title: entry.title,
					span: entry.span,
					data: null,
					problem: e instanceof Error ? e.message : String(e)
				};
			}
		})
	);
}

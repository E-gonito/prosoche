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
import type { Workspace, WorkspaceTab } from './workspaces';
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

/** What a widget module may export beside `load`, to give its tab a count. */
export type WidgetCount = (ctx: WidgetContext) => Promise<number>;

type Loader = () => Promise<{ load: WidgetLoad; count?: WidgetCount }>;

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

/**
 * The number to show on each tab, for a tab bar built before any widget on it
 * has otherwise loaded.
 *
 * A tab's count is its first widget that exports `count`, in the order the
 * workspace file lists them - `[board, time]` counts by `board`, because
 * `time` has no notion of a count. A tab with no counting widget reads null,
 * which the tab bar renders as no pill at all rather than a zero it did not
 * earn.
 *
 * An unknown widget name is skipped, the same as `loadWidgets` drops it; a
 * name that fails to import or whose `count` throws ends the search for that
 * tab with null, never an error page.
 */
export async function tabCounts(tabs: WorkspaceTab[], ctx: WidgetContext): Promise<Array<number | null>> {
	return Promise.all(tabs.map((tab) => countFor(tab.widgets, ctx)));
}

async function countFor(names: string[], ctx: WidgetContext): Promise<number | null> {
	for (const name of names) {
		if (!(name in WIDGETS) || !(name in LOADERS)) continue;
		try {
			const module = await LOADERS[name]();
			if (module.count) return await module.count(ctx);
		} catch {
			return null;
		}
	}
	return null;
}

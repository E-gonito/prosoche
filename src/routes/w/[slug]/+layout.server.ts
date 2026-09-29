import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { buildBoard } from '$server/board';
import { listDeals } from '$server/deals';
import { listPeople } from '$server/people';
import { readLog } from '$server/log';
import type { LayoutServerLoad } from './$types';

/** Sections that always exist, in reading order. Overview never hides. */
const SECTIONS = ['tasks', 'inbox', 'log', 'people', 'notes'] as const;

/**
 * The workspace itself, and which tabs have anything to show.
 *
 * Every page under `/w/[slug]` shares one workspace lookup and one tab strip,
 * computed here so a page's own load only has to fetch what it renders. A
 * tab with nothing behind it — no cards, no captures, no log entry, no people
 * or deals, no notes — is left out of the strip; its route still answers
 * when linked to directly (Overview always links to Inbox and Log, tab or
 * not), so a workspace with nothing yet is never a dead end.
 *
 * An unknown slug is a 404. There is no way back from here but the rail,
 * which still lists every workspace that does exist.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { vault, index, ready, workspaces } = hub();
	await ready;

	const defs = await workspaces();
	const workspace = defs.find((w) => w.slug === params.slug);
	if (!workspace) error(404, `There is no workspace called "${params.slug}".`);

	const home = homeFolder(workspace);
	const [inbox, logNote, people, deals, pages] = await Promise.all([
		vault.read(`${home}/Inbox.md`),
		vault.read(`${home}/Log.md`),
		listPeople(vault, index, { folders: workspace.folders, tags: [workspace.tag], slug: workspace.slug }),
		listDeals(vault, workspace),
		vault.files(`${home}/Pages`, 'html')
	]);

	const board = buildBoard(index, workspace, defs);
	const has: Record<(typeof SECTIONS)[number], boolean> = {
		tasks: board.columns.some((c) => c.cards.length > 0),
		inbox: BULLET.test(inbox.content),
		log: readLog(logNote.content).length > 0,
		people: people.length > 0 || deals.length > 0,
		notes: index.notesCount({ under: workspace.folders }) > 0
	};

	const tabs = [
		{ slug: '', title: 'Overview' },
		...SECTIONS.filter((s) => has[s]).map((s) => ({ slug: s, title: TITLES[s] })),
		...pages.map((file) => ({ slug: `pages/${encodeURIComponent(file)}`, title: pageTitle(file) }))
	];

	return {
		workspace: {
			slug: workspace.slug,
			name: workspace.name,
			color: workspace.color,
			tag: workspace.tag,
			folders: workspace.folders
		},
		definitionHref: `/notes/${workspace.path.split('/').map(encodeURIComponent).join('/')}`,
		tabs
	};
};

const BULLET = /^[ \t]*[-*+][ \t]+/m;

const TITLES: Record<(typeof SECTIONS)[number], string> = {
	tasks: 'Tasks',
	inbox: 'Inbox',
	log: 'Log',
	people: 'People',
	notes: 'Notes'
};

/** `eye-3d.html` -> "eye 3d", `Reading List.html` -> "Reading List". */
function pageTitle(file: string): string {
	const name = file.replace(/\.html?$/i, '');
	return /[A-Z ]/.test(name) ? name : name.replace(/[-_]+/g, ' ');
}

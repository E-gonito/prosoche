import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { homeFolder } from '$server/workspaces';
import { readLog } from '$server/log';
import { belongsTo, legacyInbox, readInbox, unfiled } from '$server/inbox';
import { CAPTURE_PATH } from '$server/capture';
import { readLede } from '$server/parse/note';
import type { LayoutServerLoad } from './$types';

/** Sections that always exist, in reading order. Overview and CRM never hide. */
const SECTIONS = ['crm', 'inbox', 'log', 'notes'] as const;

/**
 * The workspace itself, which tabs have anything to show, and the three
 * things the tabs are decided by: its inbox lines (the unfiled lines of
 * `Inbox/Capture.md` carrying its tag or an alias, plus any still open in
 * an old `<home>/Inbox.md`), its log entries and its custom pages.
 *
 * Every page under `/w/[slug]` shares one workspace lookup, one read of each
 * of those and one tab strip, computed here so a page's own load only has to
 * fetch what it alone renders; the Inbox and Log tabs need no load of their
 * own. A
 * tab with nothing behind it — no captures, no log entry, no notes — is
 * left out of the strip, except CRM, which always shows; its route still answers
 * when linked to directly (Overview always links to Inbox and Log, tab or
 * not), so a workspace with nothing yet is never a dead end.
 *
 * An unknown slug is a 404. There is no way back from here but the rail,
 * which still lists every workspace that does exist.
 */
export const load: LayoutServerLoad = async ({ params }) => {
	const { vault, index, workspace: find, workspaces } = await hub();
	const workspace = await find(params.slug);
	if (!workspace) error(404, `There is no workspace called "${params.slug}".`);

	const home = homeFolder(workspace);
	const logPath = `${home}/Log.md`;
	const [definition, captured, legacy, logNote, pages, all] = await Promise.all([
		vault.read(workspace.path),
		readInbox(vault),
		legacyInbox(vault, workspace),
		vault.read(logPath),
		vault.files(`${home}/Pages`, 'html'),
		workspaces()
	]);
	const inbox = unfiled(captured).filter((line) => belongsTo(line, all, workspace));
	const log = readLog(logNote.content);

	const has: Record<(typeof SECTIONS)[number], boolean> = {
		inbox: inbox.length + legacy.lines.length > 0,
		log: log.length > 0,
		crm: true,
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
			description: readLede(definition.content),
			folders: workspace.folders
		},
		tabs,
		inbox: { path: CAPTURE_PATH, lines: inbox, legacy },
		log: { path: logPath, entries: log },
		pages
	};
};

const TITLES: Record<(typeof SECTIONS)[number], string> = {
	inbox: 'Inbox',
	log: 'Log',
	crm: 'CRM',
	notes: 'Notes'
};

/** `eye-3d.html` -> "eye 3d", `Reading List.html` -> "Reading List". */
function pageTitle(file: string): string {
	const name = file.replace(/\.html?$/i, '');
	return /[A-Z ]/.test(name) ? name : name.replace(/[-_]+/g, ' ');
}

/**
 * The `notes` widget: the workspace's notes, most recently changed first.
 *
 * Also the one place that answers "which notes are these, and when did each
 * change", because the Inbox widget needs the same answer. Titles and change
 * times come from the index, which already holds both for every note, so
 * this never walks the vault to find them; the vault is only read for the
 * handful of notes actually shown, to pull the one-line preview a database
 * column does not carry.
 *
 * The title shown is the file name, not the note's own heading: a heading
 * can be anything — a date, a client name — and the file name is what the
 * user actually searched for or clicked. The note's own title rides along as
 * a subtitle, but only when it says something the file name does not.
 */

import { config } from '../config';
import { today } from '../daily';
import { basename } from '../parse/note';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { WidgetContext } from '../widgets';

export interface NoteSummary {
	path: string;
	/** The file name, without `.md`. */
	title: string;
	/** The note's own title from the index, or '' when it matches `title`. */
	subtitle: string;
	mtimeMs: number;
	/** `mtimeMs` as a calendar day, for `relativeDay` on the client. */
	day: string;
	/** First line of prose, for a widget that needs more than a title. */
	preview: string;
	/**
	 * The first subfolder under the scope this note was found in ('' for the
	 * whole vault). Empty when the note sits directly in that folder, which is
	 * the "unnamed first group" a caller renders with no heading.
	 */
	group: string;
}

export interface NotesWidget {
	notes: NoteSummary[];
	/** Folders these came from, so the widget can say what it is showing. */
	folders: string[];
	/** How many notes were in scope, of which `notes` is the newest few. */
	total: number;
	/** Today as `YYYY-MM-DD`, so the client can turn `day` into "3 days ago". */
	today: string;
}

const SHOW = 12;

export async function load(ctx: WidgetContext): Promise<NotesWidget> {
	const folders = ctx.workspace?.folders ?? [];
	const scanned = await recentNotes(ctx.vault, ctx.index, { under: folders, limit: SHOW });
	return { notes: scanned.notes, folders, total: scanned.total, today: ctx.today };
}

/**
 * The newest `limit` notes under `under`, with their titles, change times and
 * a group for presentation. An empty `under` means the whole vault. `_hub/`
 * is always left out: a workspace definition is configuration, not a note
 * someone wants to reread.
 *
 * Returns `total` as well, so a caller can say "12 of 117" honestly, counted
 * by the index rather than by fetching every row. Reads only; never writes
 * and never creates a note.
 */
export async function recentNotes(
	vault: Vault,
	index: NoteIndex,
	opts: { under: string[]; limit: number }
): Promise<{ notes: NoteSummary[]; total: number }> {
	const filter = { under: opts.under, excludePrefixes: [`${config.hubFolder}/`] };
	const found = index.notes({ ...filter, limit: opts.limit });
	const total = index.notesCount(filter);

	const notes: NoteSummary[] = [];
	for (const row of found) {
		const title = basename(row.path);
		const note = await vault.read(row.path);
		notes.push({
			path: row.path,
			title,
			subtitle: row.title !== title ? row.title : '',
			mtimeMs: row.mtimeMs,
			day: today(new Date(row.mtimeMs)),
			preview: note.exists ? preview(note.content) : '',
			group: groupOf(row.path, opts.under)
		});
	}
	return { notes, total };
}

/**
 * Which of `folders` a path lives under, or null outside all of them. Used
 * only to work out `group`; membership itself is decided by the index query
 * that produced the path in the first place.
 */
function matchingFolder(path: string, folders: string[]): string | null {
	for (const folder of folders) {
		const clean = folder.replace(/\/+$/, '');
		if (path === clean || path.startsWith(`${clean}/`)) return clean;
	}
	return null;
}

/**
 * The first subfolder under `folders` a note lives in, or '' when it sits
 * directly in one of them. With no `folders` — the whole-vault case — this is
 * the note's own top-level folder instead, so an ungrouped tab still reads as
 * sections rather than one long list.
 */
function groupOf(path: string, folders: string[]): string {
	const folder = matchingFolder(path, folders);
	const rest = folder ? path.slice(folder.length + 1) : path;
	const slash = rest.indexOf('/');
	return slash === -1 ? '' : rest.slice(0, slash);
}

/** First line of prose: frontmatter, headings and blank lines skipped. */
function preview(content: string): string {
	const lines = content.split('\n');
	let at = 0;
	if (lines[0]?.trim() === '---') {
		at = lines.findIndex((line, i) => i > 0 && line.trim() === '---') + 1;
		if (at === 0) at = lines.length;
	}
	for (let i = at; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line && !line.startsWith('#')) return line.slice(0, 140);
	}
	return '';
}

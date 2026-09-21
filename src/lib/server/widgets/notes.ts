/**
 * The `notes` widget: the workspace's notes, most recently changed first.
 *
 * Also the one place that answers "which notes are these, and when did each
 * change", because the Inbox widget needs the same answer. Titles come from
 * the index; the change time comes from the vault, since the index does not
 * expose the mtime it stores. That is why this reads the notes themselves,
 * and why the scan is capped: a folder of a thousand notes must not turn a
 * tab into a file crawl.
 */

import { config } from '../config';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { WidgetContext } from '../widgets';

export interface NoteSummary {
	path: string;
	title: string;
	mtimeMs: number;
	/** First line of prose, for a widget that needs more than a title. */
	preview: string;
}

export interface NotesWidget {
	notes: NoteSummary[];
	/** Folders these came from, so the widget can say what it is showing. */
	folders: string[];
	/** How many notes were in scope, of which `notes` is the newest few. */
	total: number;
}

/** Notes read per widget, newest-first over whatever the cap let through. */
const SCAN_LIMIT = 600;
const SHOW = 12;

export async function load(ctx: WidgetContext): Promise<NotesWidget> {
	const folders = ctx.workspace?.folders ?? [];
	const scanned = await recentNotes(ctx.vault, ctx.index, { under: folders, limit: SHOW });
	return { notes: scanned.notes, folders, total: scanned.total };
}

/**
 * The newest `limit` notes under `under`, with their titles and change times.
 * An empty `under` means the whole vault. `_hub/` is always left out: a
 * workspace definition is configuration, not a note someone wants to reread.
 *
 * Returns `total` as well, so a caller can say "12 of 117" honestly. Reads
 * only; never writes and never creates a note.
 */
export async function recentNotes(
	vault: Vault,
	index: NoteIndex,
	opts: { under: string[]; limit: number }
): Promise<{ notes: NoteSummary[]; total: number }> {
	const all = (await vault.list()).filter(
		(path) => !path.startsWith(`${config.hubFolder}/`) && inFolders(path, opts.under)
	);

	const notes: NoteSummary[] = [];
	for (const path of all.slice(0, SCAN_LIMIT)) {
		const note = await vault.read(path);
		if (!note.exists) continue;
		notes.push({
			path,
			title: index.noteTitle(path) ?? basename(path),
			mtimeMs: note.mtimeMs,
			preview: preview(note.content)
		});
	}
	notes.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return { notes: notes.slice(0, opts.limit), total: all.length };
}

function inFolders(path: string, folders: string[]): boolean {
	if (!folders.length) return true;
	return folders.some((folder) => {
		const clean = folder.replace(/\/+$/, '');
		return path === clean || path.startsWith(`${clean}/`);
	});
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

function basename(path: string): string {
	return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

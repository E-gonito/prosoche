/**
 * Which notes a study subject covers, and one shared sweep of them.
 *
 * A subject's scope is its workspace's folders and tag: its home folder,
 * where Study's own files live, and any reference folders beside it. Every
 * study module that reads notes rather than one known file — flashcards, the
 * "Make cards" button — asks the same question, "is this note in scope", and
 * this is the one place it is answered.
 *
 * The topic map that used to live here (topics from folders, syllabus
 * headings and `type: topic` notes) is gone: a subject's topics are now its
 * goals, in `goals.ts`.
 */

import { parseNote, type ParsedNote } from '../parse/note';
import type { StudyScope } from '$lib/shared/study';
import type { Vault } from '../vault/index';

/**
 * Whether a note belongs to a scope. An empty scope is the whole vault. A tag
 * matches nested tags too, so `ws/personal` covers `ws/personal/reading`.
 * Pure.
 */
export function inScope(path: string, tags: string[], scope: StudyScope | undefined): boolean {
	const folders = scope?.folders ?? [];
	const wanted = scope?.tags ?? [];
	if (!folders.length && !wanted.length) return true;
	if (folders.some((f) => path === f || path.startsWith(`${f.replace(/\/$/, '')}/`))) return true;
	return wanted.some((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)));
}

/**
 * The scope a workspace implies: its folders and its tag.
 *
 * Takes the two fields rather than a `Workspace`, so the study modules stay
 * independent of the workspace file format. Pure.
 */
export function scopeOf(workspace: { folders: string[]; tag: string }): StudyScope {
	return { folders: workspace.folders, tags: workspace.tag ? [workspace.tag] : [] };
}

/** One note, read and parsed once, as the study modules want it. */
interface ScopedNote {
	path: string;
	content: string;
	/** The note's hash as read, for a write guarded against an edit since. */
	hash: string;
	mtimeMs: number;
	parsed: ParsedNote;
}

/**
 * Every note in scope, read and parsed, from one sweep of the vault.
 *
 * Review state and card files' goals live in the markdown and the index
 * holds neither, so each of those questions means reading the notes, and a
 * page asks several at once, for several subjects. This reads the vault once
 * per change instead, keyed by the vault it was given and thrown away the
 * moment anything in that vault changes, so a page can never show what a
 * file said a second ago.
 *
 * Never writes. A note that disappears between listing and reading is skipped
 * rather than reported.
 */
export async function scopedNotes(vault: Vault, scope?: StudyScope): Promise<ScopedNote[]> {
	let entry = sweeps.get(vault);
	if (!entry) {
		entry = { pending: null };
		sweeps.set(vault, entry);
		vault.subscribe(() => {
			entry!.pending = null;
		});
	}
	entry.pending ??= sweep(vault);
	return (await entry.pending).filter((n) => inScope(n.path, n.parsed.tags, scope));
}

const sweeps = new WeakMap<Vault, { pending: Promise<ScopedNote[]> | null }>();

async function sweep(vault: Vault): Promise<ScopedNote[]> {
	const notes: ScopedNote[] = [];
	for (const path of await vault.list()) {
		if (path.startsWith('_hub/')) continue;
		const note = await vault.read(path);
		if (!note.exists) continue;
		notes.push({ path, content: note.content, hash: note.hash, mtimeMs: note.mtimeMs, parsed: parseNote(note.content, path) });
	}
	return notes;
}

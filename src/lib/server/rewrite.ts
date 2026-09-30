/**
 * Changing one note as a function of its text, safe against an edit made a
 * moment earlier somewhere else.
 *
 * The glossary and the workspace's folder list write this way on a user's
 * click: read the note, compute the new text from it, write it back pinned to
 * the hash just read, and if another device got there first, start again
 * from what it wrote. The change itself is always an insertion or a one-line
 * rewrite done by a grammar in `parse/`; nothing here knows what a note holds.
 */

import type { Vault } from './vault/index';

/** The outcome of a write. A clash is a result, not an exception. */
export type Written =
	| { ok: true; path: string }
	| { ok: false; reason: 'conflict' | 'not-found' | 'invalid'; message: string };

/**
 * Read `path`, apply `change`, and write the result with the hash just read,
 * up to `attempts` times while the write clashes.
 *
 * `change` returns the new text, or null when there is nothing to do, which
 * is reported as invalid with `unchanged` as its message. A change that
 * returns the text as it was succeeds without writing. A missing note is
 * refused as not-found unless `create` says it may start empty. Never throws
 * on a clash; after the last attempt it returns a conflict.
 */
export async function rewrite(
	vault: Vault,
	path: string,
	change: (content: string) => string | null,
	attempts: number,
	opts: { create?: boolean; unchanged?: string } = {}
): Promise<Written> {
	for (let i = 0; i < attempts; i++) {
		const note = await vault.read(path);
		if (!note.exists && !opts.create) return { ok: false, reason: 'not-found', message: 'That note is not there any more.' };
		const next = change(note.content);
		if (next === null) return invalid(opts.unchanged ?? 'Nothing to change.');
		if (next === note.content && note.exists) return { ok: true, path };
		const result = await vault.write(path, next, note.hash);
		if (result.ok) return { ok: true, path };
	}
	return conflict();
}

/** A refused request, with the reason to show. */
export function invalid(message: string): Written {
	return { ok: false, reason: 'invalid', message };
}

/** A write that lost to an edit made elsewhere. */
export function conflict(): Written {
	return { ok: false, reason: 'conflict', message: 'That note changed on another device. Reload and try again.' };
}

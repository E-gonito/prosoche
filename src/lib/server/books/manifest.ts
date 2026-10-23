/**
 * A book's folder on the shelf: which file is which, and its manifest,
 * `book.json`. Every module under `books/` names a book's files through the
 * constants here, so the layout is written down once:
 *
 *     <id>/book.json       the manifest (`BookManifest`)
 *     <id>/original.pdf    a PDF as uploaded
 *     <id>/original.epub   an EPUB as uploaded
 *     <id>/html/…          an EPUB's or a site's chapters and assets
 *     <id>/text.json       the text pulled out for search (`books/text.ts`)
 *     <id>/storage.json    a site's `localStorage`, such as quiz answers
 *
 * The manifest is derived: everything in it can be made again from the
 * book's files, and none of it is the author's reading, which is the note's.
 */

import type { Shelf } from '../vault/shelf';
import { BOOK_FORMATS, type BookManifest } from '$lib/shared/books';

export const MANIFEST = 'book.json';
export const ORIGINAL = { pdf: 'original.pdf', epub: 'original.epub' } as const;
/** The folder an EPUB's or a site's chapters are unpacked or saved into; chapter paths are relative to it. */
export const HTML_ROOT = 'html';
export const TEXT = 'text.json';
export const STORAGE = 'storage.json';

/** A book's manifest, or null when the book is not on the shelf or its manifest is unreadable. Never throws. */
export async function readManifest(shelf: Shelf, id: string): Promise<BookManifest | null> {
	try {
		const text = await shelf.readText(id, MANIFEST);
		if (!text) return null;
		const m = JSON.parse(text) as BookManifest;
		return m && m.id === id && BOOK_FORMATS.includes(m.format) && Array.isArray(m.contents) ? m : null;
	} catch {
		return null;
	}
}

/** Write a book's manifest whole. */
export async function writeManifest(shelf: Shelf, manifest: BookManifest): Promise<void> {
	await shelf.write(manifest.id, MANIFEST, `${JSON.stringify(manifest, null, '\t')}\n`);
}

/**
 * Change some fields of a book's manifest, read fresh, so two writers
 * (the text queue reporting progress, a reader saving nothing here) do not
 * undo each other's fields. Answers the manifest as written, or null when
 * the book has none. Writes are queued per book, one at a time.
 */
export async function updateManifest(shelf: Shelf, id: string, patch: Partial<Omit<BookManifest, 'id'>>): Promise<BookManifest | null> {
	const prior = queues.get(id) ?? Promise.resolve();
	const next = prior.then(async () => {
		const current = await readManifest(shelf, id);
		if (!current) return null;
		const updated = { ...current, ...patch, id };
		await writeManifest(shelf, updated);
		return updated;
	});
	const settled = next.catch(() => null);
	queues.set(id, settled);
	void settled.then(() => {
		if (queues.get(id) === settled) queues.delete(id);
	});
	return next;
}

const queues = new Map<string, Promise<unknown>>();

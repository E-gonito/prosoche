/**
 * Pulling a book's text out for search: one entry per PDF page, or per
 * section of an HTML chapter (the text between one heading with an id and
 * the next). Kept as `text.json` on the shelf, so the index can be filled
 * again on every start without extracting again.
 *
 * STUB: agent C replaces this file. The contract below is fixed.
 */

import type { Shelf } from '../vault/shelf';
import type { BookManifest, Place, TextState } from '$lib/shared/books';

/** One searchable piece of a book. */
export interface TextEntry {
	place: Place;
	/** `p. 412`, or the section's heading. */
	label: string;
	text: string;
}

/**
 * Pull the text out of a book on the shelf and write `text.json`. Reports
 * progress as it goes (`done` of `total` pages or chapters), yielding to the
 * event loop between pages so the server keeps answering. Answers the final
 * state: `done`, `none` for a PDF with no text layer, or `failed`. Never
 * throws. Does not touch the manifest; the caller records the state.
 */
export async function pullText(shelf: Shelf, manifest: BookManifest, onProgress?: (done: number, total: number) => void): Promise<TextState> {
	void shelf;
	void manifest;
	void onProgress;
	throw new Error('pullText: not built yet');
}

/** A book's `text.json`, or null when it has none yet or it is unreadable. Never throws. */
export async function readText(shelf: Shelf, id: string): Promise<TextEntry[] | null> {
	void shelf;
	void id;
	throw new Error('readText: not built yet');
}

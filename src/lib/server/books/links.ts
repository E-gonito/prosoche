/**
 * Which book a link means, so a reading-list item can open the book it names.
 *
 * A reading-list item links to a book the way Obsidian links to any note: by
 * its path, `[The Rust Book](Books/The%20Rust%20Book.md)`, or written with
 * angle brackets when it has spaces, `[CS-APP](<Books/CS-APP.md>)`. Clicking
 * it in Obsidian opens the note; in prosoche it opens the book where it was
 * left. A link to the reader itself, `/books/<id>`, is understood too. The
 * reading-list grammar does not change: these are ordinary markdown links.
 */

import { config } from '../config';
import type { BookSummary } from '$lib/shared/books';

/** What a book link shows: where to go, and the place to say. */
export interface BookLink {
	id: string;
	href: string;
	title: string;
	/** `p. 412`, or the chapter: where the author is. Null before the first read. */
	at: string | null;
}

/**
 * The book `url` links to among `books`, or null for a link to anything
 * else. Matches a vault path to a book's note (percent-encoded or not, with
 * or without the angle brackets, a leading `/` or the `.md`), or
 * `/books/<id>`. Pure.
 */
export function bookForLink(url: string | null | undefined, books: BookSummary[]): BookSummary | null {
	if (!url) return null;
	let path = url.trim().replace(/^<|>$/g, '');
	try {
		path = decodeURIComponent(path);
	} catch {
		// A stray % is kept as written.
	}
	path = path.replace(/^\/+/, '');
	const reader = /^books\/([a-z0-9-]+)\/?$/.exec(path);
	if (reader) return books.find((b) => b.id === reader[1]) ?? null;
	if (!path.startsWith(`${config.books.folder}/`)) return null;
	const note = path.endsWith('.md') ? path : `${path}.md`;
	return books.find((b) => b.note === note) ?? null;
}

/** The link to show for a book. Pure. */
export function bookLink(book: BookSummary): BookLink {
	return {
		id: book.id,
		href: `/books/${book.id}`,
		title: book.title,
		at: book.atLabel
	};
}

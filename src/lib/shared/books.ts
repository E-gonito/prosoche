/**
 * Books: what the server and the browser both need to know about one, and
 * the messages a reader and its chapter frame send each other. See
 * `docs/plan-books.md`.
 *
 * A book is two things kept apart on purpose:
 *  - its note in the vault, `Books/<Title>.md`, which is the truth about the
 *    author's reading (where they are, their highlights) and is in git;
 *  - its files on the shelf (`vault/shelf.ts`), outside the vault and out of
 *    git: the original, the HTML a site or EPUB became, the text pulled out
 *    for search, and `book.json`, the manifest below.
 *
 * Either can exist without the other. A note whose files are gone says
 * "upload the file again"; uploading it finds the note again by its id.
 */

/** `pdf` opens in the PDF reader; `epub` and `site` are HTML chapters and open in the HTML reader. */
export type BookFormat = 'pdf' | 'epub' | 'site';

export const BOOK_FORMATS: readonly BookFormat[] = ['pdf', 'epub', 'site'];

/** The upload types the shelf takes, and the format each becomes. */
export const UPLOAD_TYPES: Record<string, BookFormat> = {
	'application/pdf': 'pdf',
	'application/epub+zip': 'epub'
};

/**
 * Where in a book: a PDF page, or an HTML chapter and, within it, the id of
 * the nearest element at the top of the screen. Chapter paths are relative to
 * the book's HTML root, POSIX, never starting with `/`:
 * `ch04-02-references-and-borrowing.html`, `OEBPS/text/ch03.xhtml`.
 */
export type Place = { kind: 'page'; page: number } | { kind: 'html'; chapter: string; anchor?: string };

/** One line of a book's contents, in reading order. `depth` 0 is a top-level part or chapter. */
export interface ContentsEntry {
	title: string;
	place: Place;
	depth: number;
}

/** How far pulling a book's text out for search has got. */
export type TextState =
	| { state: 'pending' }
	| { state: 'running'; done: number; total: number }
	| { state: 'done'; parts: number }
	/** A PDF with no text layer, such as a scan: it reads, but cannot be searched. */
	| { state: 'none' }
	| { state: 'failed'; message: string };

/**
 * `book.json` on the shelf: everything derived from the book's files, so it
 * can always be made again from them. Never holds the author's reading; that
 * is the note's.
 */
export interface BookManifest {
	/** See `bookId` in `server/books/id.ts`: a hash of a file's bytes, or of a site's URL. */
	id: string;
	format: BookFormat;
	/** The book's own title (PDF metadata, the EPUB's `dc:title`, the site's `<title>`), or the file name. */
	title: string;
	/** The URL a site was saved from, or the file name an upload had. */
	source: string;
	/** Bytes this book takes on the shelf, all files included. */
	bytes: number;
	/** PDF only: how many pages. */
	pages?: number;
	/** HTML formats only: every chapter, in reading order. The first opens a book read from the start. */
	chapters?: string[];
	contents: ContentsEntry[];
	/**
	 * HTML formats only: whether the book's own scripts may run in its frame.
	 * True for a saved site (the Rust book's quizzes are scripts), false for
	 * an EPUB, which never needs one. Prosoche's bridge runs either way.
	 */
	scripts: boolean;
	text: TextState;
	/** When the files were saved, an ISO instant. */
	savedAt: string;
}

/** One highlight in a book's note: the words, where they are, and the author's comment if any. */
export interface Highlight {
	quote: string;
	place: Place;
	comment?: string;
	/** Line number in the note (0-based) of the highlight's `- >` line, so it can be found again. */
	line: number;
}

/** A book as the Books tab lists it: the note and the shelf, joined. */
export interface BookSummary {
	id: string;
	/** The note's path, `Books/<Title>.md`. */
	note: string;
	title: string;
	format: BookFormat;
	source: string;
	/** Where the author is, from the note's `at:`; null when they have not opened it. */
	at: Place | null;
	/** `placeLabel(at, manifest)`: what to call where the author is. Null when `at` is. */
	atLabel: string | null;
	/** `read_at:` from the note, `YYYY-MM-DD`, or null. */
	readAt: string | null;
	/** False when the note is there but its files are not: the book must be uploaded again. */
	onShelf: boolean;
	/** From the manifest, when the files are there. */
	pages?: number;
	bytes?: number;
	text?: TextState;
}

/** A search hit inside a book. `snippet` marks the match with « and », as note search does. */
export interface BookHit {
	book: string;
	title: string;
	place: Place;
	/** What to call the place: `p. 412`, or the section's heading. */
	label: string;
	snippet: string;
}

/**
 * Write a place the way a note's `at:` and a highlight line hold it:
 * `p. 412`, or `<chapter>#<anchor>`, or a bare chapter. Pure.
 */
export function placeText(place: Place): string {
	if (place.kind === 'page') return `p. ${place.page}`;
	return place.anchor ? `${place.chapter}#${place.anchor}` : place.chapter;
}

/**
 * Read a place back from `placeText`'s form. Null for anything else: a page
 * that is not a whole number from 1, an empty chapter, one starting with `/`
 * or holding a `..` segment, one whose file name has no extension, or
 * anything with a line break or tab. A chapter may have spaces in its path
 * (`OEBPS/Chapter 1.xhtml`). Pure; never throws.
 */
export function parsePlace(text: unknown): Place | null {
	if (typeof text !== 'string') return null;
	const t = text.trim();
	const page = /^p\.\s*(\d+)$/.exec(t);
	if (page) {
		const n = Number(page[1]);
		return Number.isSafeInteger(n) && n >= 1 ? { kind: 'page', page: n } : null;
	}
	if (!t || /[\n\r\t]/.test(t)) return null;
	const hash = t.indexOf('#');
	const chapter = hash < 0 ? t : t.slice(0, hash);
	const anchor = hash < 0 ? '' : t.slice(hash + 1);
	if (!chapter || chapter.startsWith('/') || chapter.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
	// A chapter is a file: its name has an extension (`.html`, `.xhtml`), which is
	// what tells `ch 3.xhtml` from a few words that only look like a place.
	if (!/\.[a-z0-9]{1,8}$/i.test(chapter)) return null;
	return anchor ? { kind: 'html', chapter, anchor } : { kind: 'html', chapter };
}

/**
 * What to call a place for a person: `p. 412 of 1,120` (or `p. 412` without
 * a page count), or the title of the contents entry for that chapter (the
 * one with the same anchor if there is one, else the chapter's first), else
 * the chapter's file name without its extension. Pure.
 */
export function placeLabel(place: Place, manifest?: Pick<BookManifest, 'pages' | 'contents'> | null): string {
	if (place.kind === 'page') return manifest?.pages ? `p. ${place.page.toLocaleString('en-GB')} of ${manifest.pages.toLocaleString('en-GB')}` : `p. ${place.page.toLocaleString('en-GB')}`;
	const inChapter = (manifest?.contents ?? []).filter((c) => c.place.kind === 'html' && c.place.chapter === place.chapter);
	const exact = inChapter.find((c) => c.place.kind === 'html' && c.place.anchor === place.anchor);
	const entry = exact ?? inChapter.find((c) => c.place.kind === 'html' && !c.place.anchor) ?? inChapter[0];
	if (entry) return entry.title;
	const file = place.chapter.split('/').pop() ?? place.chapter;
	return file.replace(/\.x?html?$/i, '');
}

/** Whether two places are the same spot. Pure. */
export function samePlace(a: Place | null, b: Place | null): boolean {
	return a === null || b === null ? a === b : placeText(a) === placeText(b);
}

/**
 * The messages between the HTML reader and the bridge script running inside
 * a chapter's frame. Every message carries `source: BRIDGE_SOURCE`, and each
 * side ignores anything else, and anything not from the window it expects.
 */
export const BRIDGE_SOURCE = 'prosoche-book';

/** From the frame up to the reader. */
export type FrameMessage =
	/** A chapter finished loading. `chapter` is relative to the book's HTML root. */
	| { source: typeof BRIDGE_SOURCE; type: 'ready'; chapter: string; title: string }
	/** The reader scrolled: the id of the element nearest the top of the screen, if any has one. */
	| { source: typeof BRIDGE_SOURCE; type: 'place'; chapter: string; anchor?: string }
	/** Text was selected (`quote`), or the selection went away (`null`). */
	| { source: typeof BRIDGE_SOURCE; type: 'selection'; quote: string | null }
	/** The book's page wrote to its `localStorage`: every item it now holds. */
	| { source: typeof BRIDGE_SOURCE; type: 'storage'; items: Record<string, string> };

/** From the reader down into the frame. */
export type ReaderMessage =
	/** Scroll to the element with this id, or to the top when there is none. */
	| { source: typeof BRIDGE_SOURCE; type: 'goto'; anchor?: string }
	/** Mark these quotes (highlights) and, if given, this search term, scrolling to its first match. */
	| { source: typeof BRIDGE_SOURCE; type: 'mark'; quotes: string[]; find?: string }
	/** Follow the app's theme and text size. `fontScale` 1 is the book's own size. */
	| { source: typeof BRIDGE_SOURCE; type: 'style'; theme: 'light' | 'dark'; fontScale: number };

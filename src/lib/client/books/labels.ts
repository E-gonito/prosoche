/**
 * Small pure pieces of the reader page's wording and arithmetic. The place
 * label itself is `placeLabel` in `$lib/shared/books`.
 */
import type { ContentsEntry, Place } from '$lib/shared/books';

/** Text size limits and step for HTML books; 1 is the book's own size. */
export const FONT_MIN = 0.8;
export const FONT_MAX = 1.6;

/** The text size one step up (`dir` 1) or down (-1) from `scale`, kept in range and on a tenth. */
export function stepFontScale(scale: number, dir: 1 | -1): number {
	const next = Math.round((scale + dir * 0.1) * 10) / 10;
	return Math.min(FONT_MAX, Math.max(FONT_MIN, next));
}

/** A stored text size read back: a number within range, else 1. */
export function readFontScale(stored: string | null): number {
	const n = Number(stored);
	return stored && Number.isFinite(n) && n >= FONT_MIN && n <= FONT_MAX ? Math.round(n * 10) / 10 : 1;
}

/**
 * The line of the contents `place` falls under, or -1. A PDF page falls under
 * the last entry that starts on or before it; an HTML place under the entry
 * with the same chapter and anchor if any, else the chapter's first entry.
 */
export function contentsIndex(contents: readonly ContentsEntry[], place: Place | null): number {
	if (!place) return -1;
	if (place.kind === 'page') {
		let found = -1;
		contents.forEach((c, i) => {
			if (c.place.kind === 'page' && c.place.page <= place.page) found = i;
		});
		return found;
	}
	const same = (c: ContentsEntry) => c.place.kind === 'html' && c.place.chapter === place.chapter;
	const exact = place.anchor ? contents.findIndex((c) => same(c) && c.place.kind === 'html' && c.place.anchor === place.anchor) : -1;
	return exact >= 0 ? exact : contents.findIndex(same);
}

/**
 * A search snippet as HTML: the text escaped, and the match, which the server
 * wraps in « and », in `<mark>`. The only HTML that can come out is `<mark>`.
 */
export function snippetHtml(snippet: string): string {
	const escaped = snippet.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
	return escaped.replaceAll('«', '<mark>').replaceAll('»', '</mark>');
}

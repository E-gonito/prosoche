import { error } from '@sveltejs/kit';
import { hub } from '$server/hub';
import { getBook } from '$server/books/library';
import { parsePlace, type Place } from '$lib/shared/books';
import type { PageServerLoad } from './$types';

/** The longest search term kept from `?find=`: a typed query, not a paragraph. */
const MAX_FIND = 200;

/**
 * One book for the reader: its summary, its manifest (null when its files are
 * not on the server), its highlights, and where the URL asks to open it.
 *
 * `?at=<placeText>` is the place a search hit or a link points to; it is kept
 * only if it is a place this book can have (a page within its page count for a
 * PDF, a chapter for an HTML book), else null, so the reader falls back to the
 * note's `at:`. `?find=<term>` is the search term to mark there. Answers 404
 * for an id with no note. Never writes.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const { vault, shelf } = await hub();
	const found = await getBook(vault, shelf, params.id);
	if (!found) error(404, 'No such book');

	const asked = parsePlace(url.searchParams.get('at'));
	const at: Place | null = asked && fits(asked, found.book.format, found.manifest?.pages) ? asked : null;
	const find = url.searchParams.get('find')?.trim().slice(0, MAX_FIND) || null;
	return { ...found, at, find };
};

/** Whether `place` is of the kind `format` uses, and within the page count when that is known. */
function fits(place: Place, format: 'pdf' | 'epub' | 'site', pages: number | undefined): boolean {
	if (format === 'pdf') return place.kind === 'page' && (pages === undefined || place.page <= pages);
	return place.kind === 'html';
}

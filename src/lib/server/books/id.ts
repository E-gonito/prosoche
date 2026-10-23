/**
 * A book's id: what links its note in the vault to its folder on the shelf.
 *
 * It comes from what the book is, never from when it was added, so adding
 * the same book again (after a server is rebuilt, say) finds the note it had
 * and keeps the place and highlights.
 *
 *  - A file's id is the first 16 hex digits of the sha256 of its bytes.
 *  - A site's id is `s-` and the first 14 hex digits of the sha256 of its URL
 *    with the fragment and query dropped and a trailing `index.html` or `/`
 *    trimmed, so `…/book/`, `…/book` and `…/book/index.html` are one book.
 *
 * Both match the shelf's id pattern. Pure.
 */

import { createHash } from 'node:crypto';

/** A file's id, from the sha256 of its bytes in hex (as `Shelf.putStream` answers it). */
export function fileId(sha256Hex: string): string {
	return sha256Hex.slice(0, 16).toLowerCase();
}

/** A URL as one site book: no fragment, no query, no trailing `index.html` or `/`. Null for anything not http(s). */
export function siteKey(url: string): string | null {
	let u: URL;
	try {
		u = new URL(url.trim());
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
	const path = u.pathname.replace(/\/index\.html?$/i, '').replace(/\/+$/, '');
	return `${u.protocol}//${u.host.toLowerCase()}${path}`;
}

/** A site's id, or null when the URL is not one a site can be saved from. */
export function siteId(url: string): string | null {
	const key = siteKey(url);
	return key ? `s-${createHash('sha256').update(key).digest('hex').slice(0, 14)}` : null;
}

/** True for anything `fileId` or `siteId` could have made. */
export function isBookId(id: unknown): id is string {
	return typeof id === 'string' && /^(s-[0-9a-f]{14}|[0-9a-f]{16})$/.test(id);
}

/**
 * A book's `localStorage`, kept on the shelf as `storage.json`.
 *
 * A chapter runs in a frame with an opaque origin, where the browser's real
 * `localStorage` throws, so the bridge script stands one in (see `bridge.ts`)
 * and the reader sends its contents up here after each change. That is what
 * keeps a saved site's quiz answers across page loads and across devices.
 * The file is the whole of what the book's pages hold: written whole, read
 * whole, keys and values strings only.
 */

import type { Shelf } from '../vault/shelf';
import { STORAGE } from './manifest';

/** The most one book's stored items may take, as JSON. The shelf is for books; this is bookkeeping. */
export const MAX_STORAGE_BYTES = 2 * 1024 * 1024;

export type StorageItems = Record<string, string>;

/**
 * Check a request body that claims to be a book's items: an object `{ items }`
 * whose values are all strings. `too-large` when the items, as written, would
 * be over `MAX_STORAGE_BYTES`; `invalid` for anything else. Pure; never throws.
 */
export function checkStorage(body: unknown): { ok: true; items: StorageItems } | { ok: false; reason: 'invalid' | 'too-large' } {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, reason: 'invalid' };
	const items = (body as { items?: unknown }).items;
	if (typeof items !== 'object' || items === null || Array.isArray(items)) return { ok: false, reason: 'invalid' };
	const clean: StorageItems = Object.create(null);
	for (const [key, value] of Object.entries(items)) {
		if (typeof value !== 'string') return { ok: false, reason: 'invalid' };
		clean[key] = value;
	}
	if (Buffer.byteLength(JSON.stringify(clean)) > MAX_STORAGE_BYTES) return { ok: false, reason: 'too-large' };
	return { ok: true, items: { ...clean } };
}

/** Write a book's items whole, replacing what was there. Call `checkStorage` first. */
export async function writeStorage(shelf: Shelf, id: string, items: StorageItems): Promise<void> {
	await shelf.write(id, STORAGE, JSON.stringify(items));
}

/**
 * A book's stored items, or `{}` when there are none or the file is not
 * readable as items: a book's page state is never worth failing a chapter
 * over. Never throws.
 */
export async function readStorage(shelf: Shelf, id: string): Promise<StorageItems> {
	try {
		const text = await shelf.readText(id, STORAGE);
		const checked = text === null ? null : checkStorage({ items: JSON.parse(text) });
		return checked?.ok ? checked.items : {};
	} catch {
		return {};
	}
}

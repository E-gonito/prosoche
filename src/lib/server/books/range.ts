/**
 * HTTP `Range` request headers, for serving a PDF in pieces so a phone opening
 * page 412 fetches what that page needs and not the whole file, and a book's
 * assets the same way.
 */

import type { Shelf } from '../vault/shelf';

/** What to send: the whole file, one byte range of it (inclusive), or a 416. */
export type RangeAnswer = { kind: 'whole' } | { kind: 'range'; start: number; end: number } | { kind: 'unsatisfiable' };

/**
 * Read a `Range` header against a file of `size` bytes. Understands one
 * range only, `bytes=a-b`, `bytes=a-` or the suffix form `bytes=-n`; an end
 * past the file is clamped to its last byte. A missing header, another unit,
 * several ranges or anything malformed is `whole`, which a server may always
 * answer with. A start at or past the end of the file (or any range of an
 * empty one) is `unsatisfiable`. Pure; never throws.
 */
export function parseRange(header: string | null | undefined, size: number): RangeAnswer {
	const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header ?? '');
	if (!m || (m[1] === '' && m[2] === '')) return { kind: 'whole' };
	if (m[1] === '') {
		const suffix = Number(m[2]);
		if (!Number.isSafeInteger(suffix)) return { kind: 'whole' };
		if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
		return { kind: 'range', start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(m[1]);
	const end = m[2] === '' ? Infinity : Number(m[2]);
	if (!Number.isSafeInteger(start) || (end !== Infinity && !Number.isSafeInteger(end)) || end < start) return { kind: 'whole' };
	if (start >= size) return { kind: 'unsatisfiable' };
	return { kind: 'range', start, end: Math.min(end, size - 1) };
}

/**
 * A file on the shelf as a response to `request`: 200 with the whole file,
 * 206 with the one range asked for, or 416 for a range past its end, always
 * with `Accept-Ranges` and `Content-Length`, plus the `headers` given (its
 * type, caching and so on). Null when the file is not there. Streams from
 * disk; never reads the file into memory.
 */
export async function fileResponse(shelf: Shelf, id: string, path: string, request: Request, headers: Record<string, string>): Promise<Response | null> {
	const info = await shelf.info(id, path);
	if (!info) return null;
	const asked = parseRange(request.headers.get('range'), info.size);
	const out: Record<string, string> = { ...headers, 'Accept-Ranges': 'bytes' };
	if (asked.kind === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...out, 'Content-Range': `bytes */${info.size}` } });
	const part = await shelf.stream(id, path, asked.kind === 'range' ? asked : undefined);
	if (!part) return null;
	out['Content-Length'] = String(info.size === 0 ? 0 : part.end - part.start + 1);
	if (asked.kind === 'whole') return new Response(part.body, { status: 200, headers: out });
	out['Content-Range'] = `bytes ${part.start}-${part.end}/${info.size}`;
	return new Response(part.body, { status: 206, headers: out });
}

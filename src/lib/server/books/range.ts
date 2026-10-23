/**
 * HTTP `Range` request headers, for serving a PDF in pieces so a phone opening
 * page 412 fetches what that page needs and not the whole file.
 */

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

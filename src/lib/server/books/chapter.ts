/**
 * Serving a book's HTML (an EPUB's chapters, a saved site's pages and their
 * assets) into the reader's sandboxed frame: the right type, a strict CSP,
 * and prosoche's bridge script injected into every page.
 *
 * Everything here exists because the frame is `sandbox="allow-scripts"`
 * without `allow-same-origin`: its origin is opaque, so the book's page can
 * neither touch prosoche's pages, storage and cookies nor, with the CSP
 * below, call its API or the internet. The CSP is the second lock; the first
 * is that the page has no origin of its own to be trusted as. See
 * `docs/plan-books.md`, decisions 7 and 8.
 */

import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { ShelfPathError, type Shelf } from '../vault/shelf';
import type { BookFormat, BookManifest } from '$lib/shared/books';
import { bridgeScript } from './bridge';
import { HTML_ROOT } from './manifest';
import { readStorage, type StorageItems } from './storage';

/** Content type by file extension. Anything else is `application/octet-stream`. */
const TYPES: Record<string, string> = {
	html: 'text/html',
	htm: 'text/html',
	xhtml: 'application/xhtml+xml',
	css: 'text/css',
	js: 'text/javascript',
	mjs: 'text/javascript',
	json: 'application/json',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	mp3: 'audio/mpeg',
	mp4: 'video/mp4',
	webm: 'video/webm',
	wasm: 'application/wasm',
	txt: 'text/plain',
	ncx: 'application/x-dtbncx+xml',
	opf: 'application/oebps-package+xml',
	xml: 'application/xml'
};

/** Types that are text with no way to say their encoding, so the header does: UTF-8. */
const UTF8 = new Set(['text/css', 'text/javascript', 'application/json', 'text/plain']);

/** The content type for a file name, by its extension; `application/octet-stream` when unknown. Pure. */
export function contentType(path: string): string {
	const dot = path.lastIndexOf('.');
	return (dot >= 0 && TYPES[path.slice(dot + 1).toLowerCase()]) || 'application/octet-stream';
}

/** A page the bridge goes into: HTML or XHTML. */
const isPage = (type: string): boolean => type === 'text/html' || type === 'application/xhtml+xml';

/**
 * The `Content-Security-Policy` for everything served to the frame.
 *
 * Scripts: only the bridge (by `nonce`), and, for a book allowed its own
 * scripts, files from its own folder, with `unsafe-eval` and wasm for what a
 * code editor such as Monaco needs. No connections at all (`connect-src
 * 'none'`), so a book cannot call prosoche's API or the internet; no forms;
 * no frames of its own. Pure.
 */
export function contentSecurityPolicy(nonce: string, scripts: boolean): string {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}'${scripts ? " 'self' 'unsafe-eval' 'wasm-unsafe-eval'" : ''}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"media-src 'self' blob:",
		"worker-src 'self' blob:",
		"connect-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
		"frame-src 'none'",
		"frame-ancestors 'self'"
	].join('; ');
}

/**
 * The response headers for a file of this content `type`. Every response
 * carries the CSP (a worker script is governed by its own response's) and
 * `nosniff`. A page is never cached, because it carries a fresh nonce and the
 * book's current storage; an asset is cached for an hour, and may be fetched
 * from the frame's opaque origin (fonts and module scripts are CORS requests,
 * which an opaque origin can only make to a server that answers `*`). Pure.
 */
export function chapterHeaders(o: { type: string; scripts: boolean; nonce: string }): Record<string, string> {
	const page = isPage(o.type);
	const headers: Record<string, string> = {
		'Content-Type': UTF8.has(o.type) ? `${o.type}; charset=utf-8` : o.type,
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': contentSecurityPolicy(o.nonce, o.scripts),
		'Cache-Control': page ? 'no-store' : 'private, max-age=3600'
	};
	if (!page) {
		headers['Access-Control-Allow-Origin'] = '*';
		headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
	}
	return headers;
}

/** JavaScript source for a value, safe inside a page: nothing outside printable ASCII, and no `<`, `>` or `&`. */
function jsLiteral(value: unknown): string {
	return JSON.stringify(value).replace(/[^\x20-\x7e]|[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Put prosoche's scripts into a page, as the first things in its `<head>`
 * (made if the page has none): one that sets `window.__prosocheStorage` and
 * `window.__prosocheBook`, then the bridge. Both carry `nonce`, the only way
 * the CSP lets them run.
 *
 * `html` is the page as a byte string (see `serveChapter`), and is changed
 * nowhere else, except that with `scripts` true the page's own inline
 * `<script>`s get the nonce too: a saved site's book needs them (mdBook sets
 * `path_to_root` inline) and its external scripts already run. `xml` wraps
 * the scripts in CDATA for a page served as XHTML, where an unwrapped `<` is
 * a parse error. The storage is embedded through `JSON.parse` of a string, so
 * a key such as `__proto__` stays data. Pure.
 */
export function injectBridge(html: string, o: { nonce: string; storage: StorageItems; book: { id: string; format: BookFormat }; xml: boolean; scripts: boolean }): string {
	let page = html;
	if (o.scripts) page = page.replace(/<script\b(?![^>]*\b(?:src|nonce)\s*=)/gi, `<script nonce="${o.nonce}"`);
	const script = (code: string) => `<script nonce="${o.nonce}">${o.xml ? `<![CDATA[${code}]]>` : code}</script>`;
	const inject =
		script(`window.__prosocheStorage=JSON.parse(${jsLiteral(JSON.stringify(o.storage))});window.__prosocheBook=${jsLiteral(o.book)};`) + script(bridgeScript());

	const head = /<head(?=[\s>/])[^>]*>/i.exec(page);
	if (head) {
		const end = head.index + head[0].length;
		return head[0].endsWith('/>') ? `${page.slice(0, head.index)}<head>${inject}</head>${page.slice(end)}` : page.slice(0, end) + inject + page.slice(end);
	}
	const open = /<html(?=[\s>/])[^>]*>/i.exec(page);
	if (open) {
		const end = open.index + open[0].length;
		return `${page.slice(0, end)}<head>${inject}</head>${page.slice(end)}`;
	}
	const prolog = /^(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!doctype[^>]*>\s*)?/i.exec(page)![0];
	return `${page.slice(0, prolog.length)}<head>${inject}</head>${page.slice(prolog.length)}`;
}

/**
 * `path` as a path inside `html/`, or null when it would leave it. The path
 * is as the route hands it over: already percent-decoded once. Empty segments
 * and `.` are dropped; `..`, a NUL and a backslash are refused outright.
 */
function normalise(path: string): string | null {
	if (path.includes('\0') || path.includes('\\')) return null;
	const parts = path.split('/').filter((p) => p !== '' && p !== '.');
	return parts.includes('..') ? null : parts.join('/');
}

/** `Range: bytes=a-b` or `bytes=a-` as numbers; null for no range, a suffix range or anything else. */
function parseRange(header: string | null): { start: number; end?: number } | null {
	const m = header && /^bytes=(\d+)-(\d*)$/.exec(header.trim());
	if (!m) return null;
	const start = Number(m[1]);
	const end = m[2] === '' ? undefined : Number(m[2]);
	return Number.isSafeInteger(start) && (end === undefined || Number.isSafeInteger(end)) && (end === undefined || end >= start) ? { start, end } : null;
}

/**
 * The response for `path` (relative to the book's `html/` folder, and already
 * percent-decoded, as `[...path]` arrives from the router) as the frame at
 * `/books/<id>/c/<path>` asks for it, or null when there is no such file. A
 * path that is `''` or a folder answers its `index.html`. An HTML page gets
 * the bridge and the CSP from `docs/plan-books.md` decision 7; an asset gets
 * its type and a CORS header so an opaque-origin frame may use a font or
 * module, and answers a `Range` request. Never throws for a missing file.
 *
 * Pages are read whole and handled as byte strings (Latin-1), so a page in
 * any ASCII-compatible encoding comes out byte for byte but for the injected
 * scripts, which are ASCII.
 */
export async function serveChapter(shelf: Shelf, manifest: BookManifest, path: string, request: Request): Promise<Response | null> {
	const clean = normalise(path);
	if (clean === null) return null;
	const nonce = randomBytes(16).toString('base64');
	const scripts = manifest.scripts;
	try {
		const candidates = path === '' || path.endsWith('/') ? [posix.join(clean, 'index.html')] : [clean, posix.join(clean, 'index.html')];
		for (const candidate of candidates) {
			const type = contentType(candidate);
			const file = `${HTML_ROOT}/${candidate}`;
			const headers = chapterHeaders({ type, scripts, nonce });

			if (isPage(type)) {
				const bytes = await shelf.read(manifest.id, file);
				if (!bytes) continue;
				const xml = type === 'application/xhtml+xml';
				const source = Buffer.from(bytes).toString('latin1');
				const storage = await readStorage(shelf, manifest.id);
				const page = injectBridge(source, { nonce, storage, book: { id: manifest.id, format: manifest.format }, xml, scripts });
				if (!xml && !/<meta[^>]+charset/i.test(source.slice(0, 4096))) headers['Content-Type'] = 'text/html; charset=utf-8';
				return new Response(Buffer.from(page, 'latin1'), { headers });
			}

			const range = parseRange(request.headers.get('range'));
			const stream = await shelf.stream(manifest.id, file, range ?? undefined);
			if (!stream) {
				// Not found, or a range starting past the end: a file that is there answers 416.
				const probe = range && (await shelf.stream(manifest.id, file, { start: 0, end: 0 }));
				if (!probe) continue;
				await probe.body.cancel();
				return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${probe.size}` } });
			}
			headers['Accept-Ranges'] = 'bytes';
			headers['Content-Length'] = String(stream.size === 0 ? 0 : stream.end - stream.start + 1);
			if (range) headers['Content-Range'] = `bytes ${stream.start}-${stream.end}/${stream.size}`;
			return new Response(stream.body, { status: range ? 206 : 200, headers });
		}
		return null;
	} catch (e) {
		if (e instanceof ShelfPathError) return null;
		throw e;
	}
}

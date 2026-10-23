import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Shelf } from '../vault/shelf';
import type { BookManifest } from '$lib/shared/books';
import { bridgeScript } from './bridge';
import { chapterHeaders, contentSecurityPolicy, contentType, injectBridge, serveChapter, rememberQuizzes } from './chapter';
import { HTML_ROOT, STORAGE } from './manifest';

const opts = (over: Partial<Parameters<typeof injectBridge>[1]> = {}) => ({ nonce: 'N0nce', storage: {}, book: { id: 'abcdef0123456789', format: 'epub' as const }, xml: false, scripts: false, ...over });

describe('injectBridge', () => {
	const inject = (html: string, over = {}) => injectBridge(html, opts(over));
	const bridgeTag = `<script nonce="N0nce">${bridgeScript()}</script>`;

	it('puts both scripts first inside <head>, before the page\'s own', () => {
		const out = inject('<!DOCTYPE html><html><head><title>T</title></head><body>x</body></html>');
		const at = out.indexOf('<head>') + '<head>'.length;
		expect(out.slice(at)).toMatch(/^<script nonce="N0nce">window\.__prosocheStorage=/);
		expect(out.indexOf(bridgeTag)).toBeGreaterThan(at);
		expect(out.indexOf(bridgeTag) + bridgeTag.length).toBe(out.indexOf('<title>'));
	});

	it('keeps head attributes, and does not mistake <header> for <head>', () => {
		const out = inject('<html><body><header>h</header></body><head lang="en"><title/></head></html>');
		expect(out.indexOf('<head lang="en"><script')).toBeGreaterThan(-1);
		expect(out).toContain('<header>h</header>');
	});

	it('makes a head after <html> when there is none', () => {
		const out = inject('<html lang="en"><body>x</body></html>');
		expect(out).toMatch(/^<html lang="en"><head><script nonce/);
		expect(out).toMatch(/<\/script><\/head><body>x<\/body><\/html>$/);
	});

	it('makes one after the prolog and doctype of a page with no <html>', () => {
		const out = inject('<?xml version="1.0"?>\n<!DOCTYPE html>\n<p>bare</p>');
		expect(out).toMatch(/^<\?xml version="1.0"\?>\n<!DOCTYPE html>\n<head><script nonce/);
		expect(out.endsWith('</head><p>bare</p>')).toBe(true);
	});

	it('expands an empty <head/> in XHTML', () => {
		expect(inject('<html><head/><body/></html>', { xml: true })).toMatch(/<head><script nonce="N0nce"><!\[CDATA\[.*<\/script><\/head><body\/>/s);
	});

	it('wraps both scripts in CDATA for XHTML, and in nothing for HTML', () => {
		const xml = inject('<html><head></head></html>', { xml: true });
		expect(xml.match(/<!\[CDATA\[/g)).toHaveLength(2);
		expect(xml.match(/\]\]><\/script>/g)).toHaveLength(2);
		expect(inject('<html><head></head></html>')).not.toContain('CDATA');
	});

	it('sets the book and its storage, escaped so the page cannot be broken out of', () => {
		const storage = JSON.parse('{"</script><img src=x onerror=alert(1)>":"]]>","a&b":"\\u2028\\u00e9\\ud83d\\ude00","__proto__":"x"}');
		for (const xml of [false, true]) {
			const out = inject('<html><head></head></html>', { storage, xml });
			const head = out.slice(0, out.indexOf('<script', out.indexOf('<script') + 1));
			expect(head).not.toMatch(/<\/script>.*<\/script>/s);
			expect(head).not.toMatch(/<img/);
			expect(head).toMatch(/^[\x20-\x7e]*$/);
			if (xml) expect(head.slice(0, head.lastIndexOf(']]>')).includes(']]>')).toBe(false);
			// What the page would see:
			const code = /<script nonce="N0nce">(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/script>/s.exec(head)![1];
			const win: Record<string, unknown> = {};
			new Function('window', code)(win);
			expect(win.__prosocheStorage).toEqual(storage);
			expect(Object.keys(win.__prosocheStorage as object)).toContain('__proto__');
			expect(win.__prosocheBook).toEqual({ id: 'abcdef0123456789', format: 'epub' });
		}
	});

	it('gives the page\'s own inline scripts the nonce only for a book allowed its scripts', () => {
		const page = '<html><head><script>var path_to_root="";</script><script src="a.js"></script><script nonce="x">1</script></head></html>';
		const off = inject(page);
		expect(off).toContain('<script>var path_to_root');
		const on = inject(page, { scripts: true });
		expect(on).toContain('<script nonce="N0nce">var path_to_root');
		expect(on).toContain('<script src="a.js">');
		expect(on).toContain('<script nonce="x">1');
	});

	it('leaves the page itself byte for byte, whatever its encoding', () => {
		const page = '<html><head><meta charset="windows-1252"></head><body>caf\xe9 \x93quoted\x94</body></html>';
		const out = inject(page);
		expect(out.endsWith('</script><meta charset="windows-1252"></head><body>caf\xe9 \x93quoted\x94</body></html>')).toBe(true);
	});
});

describe('contentType', () => {
	const table: [string, string][] = [
		['a.html', 'text/html'], ['a.HTM', 'text/html'], ['a.xhtml', 'application/xhtml+xml'], ['x/y.css', 'text/css'], ['a.js', 'text/javascript'], ['a.mjs', 'text/javascript'],
		['a.json', 'application/json'], ['a.svg', 'image/svg+xml'], ['a.png', 'image/png'], ['a.jpg', 'image/jpeg'], ['a.jpeg', 'image/jpeg'], ['a.gif', 'image/gif'],
		['a.webp', 'image/webp'], ['a.avif', 'image/avif'], ['a.woff', 'font/woff'], ['a.woff2', 'font/woff2'], ['a.ttf', 'font/ttf'], ['a.otf', 'font/otf'],
		['a.mp3', 'audio/mpeg'], ['a.mp4', 'video/mp4'], ['a.webm', 'video/webm'], ['a.wasm', 'application/wasm'], ['a.txt', 'text/plain'], ['a.ncx', 'application/x-dtbncx+xml'],
		['a.opf', 'application/oebps-package+xml'], ['a.xml', 'application/xml'], ['a.bin', 'application/octet-stream'], ['noext', 'application/octet-stream'], ['a.b/c', 'application/octet-stream']
	];
	for (const [path, type] of table) it(path, () => expect(contentType(path)).toBe(type));
});

describe('contentSecurityPolicy', () => {
	it('lets only the bridge script run for an EPUB', () => {
		const csp = contentSecurityPolicy('abc', false);
		expect(csp).toContain("script-src 'nonce-abc';");
		expect(csp).not.toContain('unsafe-eval');
	});
	it('adds the book\'s own scripts, eval and wasm for a site', () => {
		expect(contentSecurityPolicy('abc', true)).toContain("script-src 'nonce-abc' 'self' 'unsafe-eval' 'wasm-unsafe-eval';");
	});
	it('cuts every other door', () => {
		const csp = contentSecurityPolicy('abc', true);
		for (const d of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-src 'none'", "frame-ancestors 'self'", 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox']) expect(csp).toContain(d);
	});
});

describe('chapterHeaders', () => {
	const h = (type: string, scripts = false) => chapterHeaders({ type, scripts, nonce: 'abc' });

	it('never caches a page, and gives it no CORS or resource-policy headers', () => {
		for (const type of ['text/html', 'application/xhtml+xml']) {
			const headers = h(type);
			expect(headers['Cache-Control']).toBe('no-store');
			expect(headers['Content-Type']).toBe(type);
			expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
			expect(headers).not.toHaveProperty('Cross-Origin-Resource-Policy');
		}
	});
	it('caches an asset for an hour and lets an opaque origin use it', () => {
		const headers = h('font/woff2');
		expect(headers['Cache-Control']).toBe('private, max-age=3600');
		expect(headers['Access-Control-Allow-Origin']).toBe('*');
		expect(headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
	});
	it('says nosniff and carries the CSP on everything', () => {
		for (const type of ['text/html', 'text/css', 'application/octet-stream']) {
			expect(h(type)['X-Content-Type-Options']).toBe('nosniff');
			expect(h(type)['Content-Security-Policy']).toBe(contentSecurityPolicy('abc', false));
		}
		expect(h('text/css', true)['Content-Security-Policy']).toBe(contentSecurityPolicy('abc', true));
	});
	it('names UTF-8 for text it cannot otherwise place', () => {
		expect(h('text/css')['Content-Type']).toBe('text/css; charset=utf-8');
		expect(h('text/javascript')['Content-Type']).toBe('text/javascript; charset=utf-8');
		expect(h('image/png')['Content-Type']).toBe('image/png');
	});
});

describe('serveChapter', () => {
	const ID = 'abcdef0123456789';
	let root: string;
	let shelf: Shelf;
	const manifest = (over: Partial<BookManifest> = {}): BookManifest => ({ id: ID, format: 'epub', title: 'T', source: 's', bytes: 0, contents: [], scripts: false, text: { state: 'pending' }, savedAt: '', ...over });
	const get = (m: BookManifest, path: string, headers: Record<string, string> = {}) => serveChapter(shelf, m, path, new Request(`http://x/books/${ID}/c/${path}`, { headers }));

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-chapter-'));
		shelf = new Shelf(root);
		await shelf.write(ID, `${HTML_ROOT}/index.html`, '<html><head><title>Home</title></head><body>home</body></html>');
		await shelf.write(ID, `${HTML_ROOT}/OEBPS/ch 1.xhtml`, '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>one</body></html>');
		await shelf.write(ID, `${HTML_ROOT}/dir/index.html`, '<html><head></head><body>dir</body></html>');
		await shelf.write(ID, `${HTML_ROOT}/a.css`, 'body{}');
		await shelf.write(ID, `${HTML_ROOT}/f.woff2`, '0123456789');
		await shelf.write(ID, STORAGE, JSON.stringify({ quiz: '3/4' }));
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('serves a page with the bridge, the CSP and the book\'s storage', async () => {
		const res = (await get(manifest(), 'index.html'))!;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('no-store');
		const csp = res.headers.get('content-security-policy')!;
		const nonce = /'nonce-([^']+)'/.exec(csp)![1];
		const body = await res.text();
		expect(body).toContain(`<script nonce="${nonce}">window.__prosocheStorage=JSON.parse("{\\"quiz\\":\\"3/4\\"}");`);
		expect(body).toContain('<title>Home</title>');
		expect(body).toContain(bridgeScript());
	});

	it('uses a new nonce for every response', async () => {
		const a = (await get(manifest(), 'index.html'))!.headers.get('content-security-policy');
		const b = (await get(manifest(), 'index.html'))!.headers.get('content-security-policy');
		expect(a).not.toBe(b);
	});

	it('serves .xhtml as XHTML with CDATA scripts', async () => {
		const res = (await get(manifest(), 'OEBPS/ch 1.xhtml'))!;
		expect(res.headers.get('content-type')).toBe('application/xhtml+xml');
		expect(await res.text()).toContain('<![CDATA[');
	});

	it('maps \'\' and a folder to index.html, with or without a slash', async () => {
		expect(await (await get(manifest(), ''))!.text()).toContain('home');
		expect(await (await get(manifest(), 'dir'))!.text()).toContain('dir');
		expect(await (await get(manifest(), 'dir/'))!.text()).toContain('dir');
	});

	it('allows scripts in the CSP only for a book that may run them', async () => {
		expect((await get(manifest({ scripts: true }), 'index.html'))!.headers.get('content-security-policy')).toContain("'self' 'unsafe-eval'");
		expect((await get(manifest(), 'index.html'))!.headers.get('content-security-policy')).not.toContain("'self' 'unsafe-eval'");
	});

	it('serves an asset as it is, with its type, CORS and cache headers', async () => {
		const res = (await get(manifest(), 'a.css'))!;
		expect(await res.text()).toBe('body{}');
		expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('answers a range with 206, and a range past the end with 416', async () => {
		const res = (await get(manifest(), 'f.woff2', { range: 'bytes=2-5' }))!;
		expect(res.status).toBe(206);
		expect(await res.text()).toBe('2345');
		expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
		expect(res.headers.get('content-length')).toBe('4');
		const open = (await get(manifest(), 'f.woff2', { range: 'bytes=7-' }))!;
		expect(await open.text()).toBe('789');
		const past = (await get(manifest(), 'f.woff2', { range: 'bytes=50-60' }))!;
		expect(past.status).toBe(416);
		expect(past.headers.get('content-range')).toBe('bytes */10');
		const suffix = (await get(manifest(), 'f.woff2', { range: 'bytes=-3' }))!;
		expect(suffix.status).toBe(206);
		expect(await suffix.text()).toBe('789');
		const whole = (await get(manifest(), 'f.woff2', { range: 'items=0-1' }))!;
		expect(whole.status).toBe(200);
	});

	it('is null for a file that is not there, whatever the range', async () => {
		expect(await get(manifest(), 'missing.html')).toBeNull();
		expect(await get(manifest(), 'missing.css', { range: 'bytes=0-1' })).toBeNull();
		expect(await get(manifest(), 'nodir/')).toBeNull();
	});

	it('is null for any path that would leave html/, and never reaches the manifest or storage', async () => {
		for (const path of ['../book.json', '../storage.json', 'a/../../book.json', '..', '/etc/passwd/..', 'a\\..\\b', 'a\0b']) expect(await get(manifest(), path), path).toBeNull();
		expect(await get(manifest(), '/index.html')).not.toBeNull();
	});

	it('serves a Latin-1 page byte for byte', async () => {
		await shelf.write(ID, `${HTML_ROOT}/latin.html`, Uint8Array.from([...'<html><head><meta charset="windows-1252"></head><body>caf'].map((c) => c.charCodeAt(0)).concat([0xe9])));
		const res = (await get(manifest(), 'latin.html'))!;
		expect(res.headers.get('content-type')).toBe('text/html');
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(bytes.at(-1)).toBe(0xe9);
	});
});

describe('rememberQuizzes', () => {
	it.each([
		['<div class="quiz-placeholder" data-quiz-name="&quot;a&quot;">', '<div class="quiz-placeholder" data-quiz-name="&quot;a&quot;" data-quiz-cache-answers="true">'],
		["<div data-x class='box quiz-placeholder big'/>", `<div data-x class='box quiz-placeholder big' data-quiz-cache-answers="true"/>`],
		['<div class="quiz-placeholder" data-quiz-cache-answers="false">', '<div class="quiz-placeholder" data-quiz-cache-answers="false">'],
		['<div class="quiz-placeholders">', '<div class="quiz-placeholders">'],
		['<p>quiz-placeholder</p>', '<p>quiz-placeholder</p>']
	])('%s', (html, expected) => {
		expect(rememberQuizzes(html)).toBe(expected);
	});
});

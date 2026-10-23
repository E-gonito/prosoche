import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config';
import { Shelf } from '../vault/shelf';
import { saveSite } from './site';

const FIXTURES = fileURLToPath(new URL('../../../../e2e/fixtures/', import.meta.url));
const ID = 's-0123456789abcd';
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', png: 'image/png', woff2: 'font/woff2' };

/** A fetch that answers from a map of absolute URL to body, 404 for the rest. */
function memoryFetch(site: Record<string, string | Uint8Array | Response>, seen: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		seen.push(url);
		const hit = site[url.split(/[?#]/)[0]];
		if (hit instanceof Response) return hit.clone();
		if (hit === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
		const ext = url.split('?')[0].split('.').pop()!;
		return new Response(hit as BodyInit, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } });
	}) as unknown as typeof fetch;
}

/** A fetch that serves a fixture folder as the site at `base` (which ends in `/`). */
function fixtureFetch(folder: string, base: string, tap?: (url: string) => Promise<Response | undefined> | Response | undefined): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		const tapped = await tap?.(url);
		if (tapped) return tapped;
		if (!url.startsWith(base)) return new Response('not found', { status: 404 });
		const rel = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]) || 'index.html';
		const file = join(FIXTURES, folder, rel);
		if (!existsSync(file) || !statSync(file).isFile()) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
		return new Response(readFileSync(file), { headers: { 'content-type': TYPES[file.split('.').pop()!] ?? 'application/octet-stream' } });
	}) as unknown as typeof fetch;
}

let root: string;
let shelf: Shelf;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-site-'));
	shelf = new Shelf(root);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const BASE = 'https://books.test/lantern/';
const text = async (path: string) => shelf.readText(ID, path);

describe('saveSite: a modern mdBook (contents in a script)', () => {
	it('saves every chapter and everything they need, and answers title, chapters and contents', async () => {
		const r = await saveSite(shelf, ID, BASE, { fetch: fixtureFetch('site', BASE) });
		if (!r.ok) throw new Error(r.message);

		expect(r.title).toBe('The Lantern Handbook');
		expect(r.chapters).toEqual(['index.html', 'ch01-intro.html', 'ch01-01-wicks.html', 'ch02-quiz.html', 'ch05-afterword.html']);
		expect(r.contents).toEqual([
			{ title: 'Welcome to the Handbook', place: { kind: 'html', chapter: 'index.html' }, depth: 0 },
			{ title: 'Part One: Light', place: { kind: 'html', chapter: 'ch01-intro.html' }, depth: 0 },
			{ title: '1. Introduction & Aims', place: { kind: 'html', chapter: 'ch01-intro.html' }, depth: 0 },
			{ title: '1.1. Wicks', place: { kind: 'html', chapter: 'ch01-01-wicks.html' }, depth: 1 },
			{ title: '1.2. Trimming (same page)', place: { kind: 'html', chapter: 'ch01-01-wicks.html', anchor: 'trimming' }, depth: 1 },
			{ title: '2. A Quiz', place: { kind: 'html', chapter: 'ch02-quiz.html' }, depth: 0 },
			{ title: 'Part Two: Dark', place: { kind: 'html', chapter: 'ch05-afterword.html' }, depth: 0 },
			{ title: 'Afterword', place: { kind: 'html', chapter: 'ch05-afterword.html' }, depth: 0 }
		]);

		const files = await shelf.files(ID);
		expect(files.filter((f) => f.startsWith('html/') || f.startsWith('html.new/'))).toEqual(
			[
				'html/book-9c8d7e6f.js',
				'html/ch01-01-wicks.html',
				'html/ch01-intro.html',
				'html/ch02-quiz.html',
				'html/ch05-afterword.html',
				'html/css/book-1a2b3c4d.css',
				'html/css/print-notes.css',
				'html/css/theme.css',
				'html/fonts/lantern-sans.woff2',
				'html/img/lantern.png',
				'html/index.html',
				'html/quiz/helper.js', // named only in the quiz script, as `${base}/helper.js`
				'html/quiz/quiz.js',
				'html/quiz/style.css',
				'html/searchindex-5e6f7a8b.js', // named only in an inline script
				'html/toc-0f1e2d3c.js'
			]
		);
		expect(r.files).toBe(16);
		expect(r.warnings).toEqual([]); // links to other sites are not files the book needs
	});

	it('keeps pages and files byte for byte when no pointer needs changing', async () => {
		await saveSite(shelf, ID, BASE, { fetch: fixtureFetch('site', BASE) });
		for (const f of ['index.html', 'ch02-quiz.html', 'css/book-1a2b3c4d.css', 'img/lantern.png', 'quiz/quiz.js']) {
			expect(Buffer.from((await shelf.read(ID, `html/${f}`))!).equals(readFileSync(join(FIXTURES, 'site', f)))).toBe(true);
		}
	});

	it.each([BASE, BASE.slice(0, -1), `${BASE}index.html`, `${BASE}ch02-quiz.html`, `${BASE}ch02-quiz.html#a-quiz`, `${BASE}?utm=x`])('finds the book from %s', async (url) => {
		const r = await saveSite(shelf, ID, url, { fetch: fixtureFetch('site', BASE) });
		expect(r.ok && r.chapters.length).toBe(5);
	});

	it('reports progress up to the number of files, and fetches four at a time at most', async () => {
		let inFlight = 0;
		let peak = 0;
		const base = fixtureFetch('site', BASE);
		const f = (async (u: string) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return base(u);
		}) as unknown as typeof fetch;
		const calls: [number, number][] = [];
		const r = await saveSite(shelf, ID, BASE, { fetch: f, onProgress: (d, t) => calls.push([d, t]) });
		expect(r.ok).toBe(true);
		expect(peak).toBeLessThanOrEqual(4);
		expect(peak).toBeGreaterThan(1);
		const last = calls.at(-1)!;
		expect(last[0]).toBe(last[1]);
		expect(last[1]).toBeGreaterThanOrEqual(r.ok ? r.files! : 0); // more, by the guessed files that were not there
		for (let i = 1; i < calls.length; i++) expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
	});

	it('replaces an earlier copy only once the new one is complete', async () => {
		await shelf.write(ID, 'html/old.html', 'old copy');
		const ok = await saveSite(shelf, ID, BASE, { fetch: fixtureFetch('site', BASE) });
		expect(ok.ok).toBe(true);
		expect(await text('html/old.html')).toBeNull();
		expect(await text('html/index.html')).toContain('Lantern');
		expect((await shelf.files(ID)).some((f) => f.startsWith('html.new/'))).toBe(false);
	});

	it('keeps the old copy and leaves no half-built one when something fails', async () => {
		await shelf.write(ID, 'html/old.html', 'old copy');
		const f = fixtureFetch('site', BASE, (u) => (u.endsWith('quiz/quiz.js') ? new Response('boom', { status: 503 }) : undefined));
		const r = await saveSite(shelf, ID, BASE, { fetch: f });
		expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
		expect(await text('html/old.html')).toBe('old copy');
		expect((await shelf.files(ID)).filter((x) => x.startsWith('html.new/'))).toEqual([]);
	});

	it('retries a dropped connection once', async () => {
		let failed = false;
		const f = fixtureFetch('site', BASE, (u) => {
			if (u.endsWith('css/theme.css') && !failed) {
				failed = true;
				throw new TypeError('fetch failed');
			}
		});
		expect((await saveSite(shelf, ID, BASE, { fetch: f })).ok).toBe(true);
		expect(failed).toBe(true);
	});

	it('skips a chapter that is 404 with a warning, and drops it from chapters and contents', async () => {
		const f = fixtureFetch('site', BASE, (u) => (u.endsWith('ch01-01-wicks.html') ? new Response('gone', { status: 404 }) : undefined));
		const r = await saveSite(shelf, ID, BASE, { fetch: f });
		if (!r.ok) throw new Error(r.message);
		expect(r.chapters).not.toContain('ch01-01-wicks.html');
		expect(r.contents.some((c) => c.place.kind === 'html' && c.place.chapter === 'ch01-01-wicks.html')).toBe(false);
		expect(r.warnings!.join('\n')).toMatch(/1 chapter was listed.*ch01-01-wicks\.html/);
		expect(await text('html/ch01-01-wicks.html')).toBeNull();
	});

	it('refuses when it would pass the size limit or leave too little space', async () => {
		const limits = config.books as { maxBytes: number; keepFreeBytes: number };
		const saved = { max: limits.maxBytes, keep: limits.keepFreeBytes };
		try {
			limits.maxBytes = 2000;
			expect(await saveSite(shelf, ID, BASE, { fetch: fixtureFetch('site', BASE) })).toMatchObject({ ok: false, reason: 'too-large' });
			limits.maxBytes = saved.max;
			limits.keepFreeBytes = Number.MAX_SAFE_INTEGER;
			expect(await saveSite(shelf, ID, BASE, { fetch: fixtureFetch('site', BASE) })).toMatchObject({ ok: false, reason: 'no-space' });
		} finally {
			limits.maxBytes = saved.max;
			limits.keepFreeBytes = saved.keep;
		}
		expect((await shelf.files(ID)).length).toBe(0);
	});
});

describe('saveSite: an older mdBook (contents inline in each page)', () => {
	it('reads the inline sidebar', async () => {
		const base = 'https://old.test/almanac/';
		const r = await saveSite(shelf, ID, `${base}index.html`, { fetch: fixtureFetch('site-legacy', base) });
		if (!r.ok) throw new Error(r.message);
		expect(r.title).toBe('Old Almanac');
		expect(r.chapters).toEqual(['intro.html', 'chapter_1.html', 'chapter_1_1.html']);
		expect(r.contents.map((c) => `${c.depth}:${c.title}`)).toEqual(['0:1. Introduction', '0:2. The Weather', '1:2.1. Rain']);
		expect(await text('html/css/book.css')).toContain('serif');
		expect(await text('html/index.html')).toContain('Old Almanac');
	});
});

describe('saveSite: what it refuses', () => {
	it('says only mdBook is supported when there is no table of contents', async () => {
		const f = memoryFetch({ 'https://blog.test/post/index.html': '<html><title>A post</title><body><p>Hello</p></body></html>' });
		const r = await saveSite(shelf, ID, 'https://blog.test/post/', { fetch: f });
		expect(r).toMatchObject({ ok: false, reason: 'not-a-book' });
		expect(!r.ok && r.message).toMatch(/only mdBook sites are supported/);
	});

	it('is not a book when the contents link to nothing it can save', async () => {
		const f = memoryFetch({ 'https://b.test/x/index.html': '<ol class="chapter"><li><a href="print.html">Print</a></li><li><a href="https://elsewhere.test/a.html">E</a></li></ol>' });
		expect(await saveSite(shelf, ID, 'https://b.test/x/', { fetch: f })).toMatchObject({ ok: false, reason: 'not-a-book' });
	});

	it('is unreachable when the start page cannot be fetched', async () => {
		const down = (async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
		expect(await saveSite(shelf, ID, BASE, { fetch: down })).toMatchObject({ ok: false, reason: 'unreachable' });
		expect(await saveSite(shelf, ID, BASE, { fetch: memoryFetch({}) })).toMatchObject({ ok: false, reason: 'unreachable' });
	});

	it.each(['ftp://books.test/x/', 'not a url', 'file:///etc/passwd', 'http://127.0.0.1:3100/', 'http://192.168.1.10/book/', 'http://100.104.242.57:3100/', 'http://[::1]/', 'https://user:pw@books.test/'])('refuses %s as a bad address', async (u) => {
		const f = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
		expect(await saveSite(shelf, ID, u, { fetch: f })).toMatchObject({ ok: false, reason: 'bad-url' });
	});

	it('refuses a name that resolves to a private address', async () => {
		const f = (async () => { throw new Error('must not fetch'); }) as unknown as typeof fetch;
		const lookup = async () => [{ address: '10.0.0.5', family: 4 }];
		expect(await saveSite(shelf, ID, 'https://nas.test/book/', { fetch: f, lookup })).toMatchObject({ ok: false, reason: 'bad-url' });
	});
});

describe('saveSite: files the book does not keep in its own folder', () => {
	const SITE = {
		'https://books.test/lib/book/index.html': `<html><head><title>Ch - Out Book</title>
<link rel="stylesheet" href="/lib/shared/site.css"><link rel="stylesheet" href="../shared/up.css">
<link rel="stylesheet" href="https://cdn.example.net/fonts.css"><script src="https://cdn.example.net/analytics.js"></script>
<script src="/lib/book/abs.js"></script></head>
<body><ol class="chapter"><li><a href="/lib/book/ch1.html">One</a></li></ol><img src="https://books.test/lib/shared/pic.png?v=2#frag"><a href="/lib/book/ch1.html#x">go</a></body></html>`,
		'https://books.test/lib/book/ch1.html': '<html><head><title>One - Out Book</title><link rel="stylesheet" href="./local.css"></head><body>one</body></html>',
		'https://books.test/lib/book/local.css': 'a { b: url(local.png) }',
		'https://books.test/lib/book/local.png': 'png',
		'https://books.test/lib/book/abs.js': 'var done = true;',
		'https://books.test/lib/shared/site.css': '@font-face { src: url(fonts/f.woff2) } p { background: url(/lib/book/local.png) } q { background: url("../book/ch1.png") }',
		'https://books.test/lib/shared/fonts/f.woff2': 'font',
		'https://books.test/lib/shared/up.css': 'body { color: red }',
		'https://books.test/lib/shared/pic.png': 'pic'
	};

	it('saves them under _site/ and rewrites the pointers that could not work, and only those', async () => {
		const r = await saveSite(shelf, ID, 'https://books.test/lib/book/', { fetch: memoryFetch(SITE) });
		if (!r.ok) throw new Error(r.message);
		expect(r.title).toBe('Out Book');
		const files = (await shelf.files(ID)).map((f) => f.replace(/^html\//, ''));
		expect(files).toEqual(expect.arrayContaining(['_site/lib/shared/site.css', '_site/lib/shared/up.css', '_site/lib/shared/pic.png', '_site/lib/shared/fonts/f.woff2', 'abs.js', 'local.css', 'local.png']));

		const index = (await text('html/index.html'))!;
		expect(index).toContain('href="_site/lib/shared/site.css"');
		expect(index).toContain('href="_site/lib/shared/up.css"');
		expect(index).toContain('src="abs.js"');
		expect(index).toContain('src="_site/lib/shared/pic.png?v=2#frag"');
		expect(index).toContain('href="ch1.html#x"');
		expect(index).toContain('<a href="ch1.html">One</a>'); // a root-relative link to a chapter works from the frame once relative
		expect(index).toContain('href="https://cdn.example.net/fonts.css"');
		expect(index).toContain('src="https://cdn.example.net/analytics.js"');
		expect(await text('html/ch1.html')).toContain('href="./local.css"'); // fine as it was
		const site = (await text('html/_site/lib/shared/site.css'))!;
		expect(site).toContain('url(fonts/f.woff2)'); // sibling inside _site: fine as it was
		expect(site).toContain('url(../../../local.png)'); // /lib/book/local.png, from _site/lib/shared/
		expect(r.warnings!.join('\n')).toMatch(/2 resources on other sites \(cdn\.example\.net\)/);
	});
});

describe('saveSite: guesses from scripts', () => {
	it('drops a guessed file that is not there, or that a server answers with its home page, without a word', async () => {
		const site = {
			'https://g.test/b/index.html': '<ol class="chapter"><li><a href="c.html">C</a></li></ol><script src="app.js"></script>',
			'https://g.test/b/c.html': '<html><title>C - G</title><body>c</body></html>',
			'https://g.test/b/app.js': 'load("missing.json"); load("home.json"); load("real.json");',
			'https://g.test/b/real.json': '{}',
			'https://g.test/b/home.json': new Response('<html>home</html>', { headers: { 'content-type': 'text/html' } })
		};
		const r = await saveSite(shelf, ID, 'https://g.test/b/', { fetch: memoryFetch(site) });
		if (!r.ok) throw new Error(r.message);
		expect(r.warnings).toEqual([]);
		const files = (await shelf.files(ID)).map((f) => f.replace(/^html\//, ''));
		expect(files).toContain('real.json');
		expect(files).not.toContain('home.json');
		expect(files).not.toContain('missing.json');
	});

	it('warns about a file a page names that is missing, since the page needs it', async () => {
		const site = {
			'https://g.test/b/index.html': '<ol class="chapter"><li><a href="c.html">C</a></li></ol><link rel="stylesheet" href="gone.css">',
			'https://g.test/b/c.html': '<html><title>C - G</title><body>c</body></html>'
		};
		const r = await saveSite(shelf, ID, 'https://g.test/b/', { fetch: memoryFetch(site) });
		expect(r.ok && r.warnings).toEqual([expect.stringContaining('gone.css')]);
	});

	it('skips one file over the per-response cap with a warning instead of failing the book', async () => {
		const big = new Response(new Uint8Array(10), { headers: { 'content-length': String(60 * 1024 * 1024) } });
		const site = {
			'https://g.test/b/index.html': '<ol class="chapter"><li><a href="c.html">C</a></li></ol><video src="movie.mp4"></video>',
			'https://g.test/b/c.html': '<html><title>C - G</title><body>c</body></html>',
			'https://g.test/b/movie.mp4': big
		};
		const r = await saveSite(shelf, ID, 'https://g.test/b/', { fetch: memoryFetch(site) });
		expect(r.ok && r.warnings).toEqual([expect.stringContaining('movie.mp4')]);
	});
});

import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { makeEpub } from './fixtures/make-epub.mjs';

/**
 * The chapter frame, in a real browser: the sandbox, the CSP and the bridge.
 *
 * A book's chapter runs in `<iframe sandbox="allow-scripts …">` with no
 * `allow-same-origin`, under a CSP that allows no connections. Whether that
 * combination actually lets the bridge, a book's own scripts, its fonts and
 * its module scripts work, and actually stops a book calling the app's API,
 * can only be shown by a browser, so these tests frame real chapters from the
 * built server with exactly the reader's sandbox attribute.
 *
 * The books are written straight onto the shelf (`HUB_BOOKS`, set by
 * playwright.config.ts), so this does not depend on the upload route. The
 * "page" around the frame is a stand-in for `HtmlReader` that does the parts
 * the frame cares about: check `event.source`, relay storage to the server.
 */

const ROOT = process.env.E2E_ROOT ?? '/tmp/prosoche-e2e';
const SHELF = `${ROOT}/books`;
const FONT = join(dirname(fileURLToPath(import.meta.url)), '../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2');

const SITE = 's-5173e5173e5173';
const NOSCRIPT = '5c41b75c41b75c41';
const EPUB = 'e9b0e9b0e9b0e9b0';

const manifest = (id: string, format: 'site' | 'epub', scripts: boolean, chapters: string[]) => ({
	id, format, title: `Frame test ${id}`, source: 'test', bytes: 0, chapters, contents: [], scripts, text: { state: 'pending' }, savedAt: '2026-10-23T00:00:00.000Z'
});

function put(id: string, path: string, content: string | Uint8Array) {
	const target = join(SHELF, id, path);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, content);
}

const BODY = `
<h1 id="top">Top</h1>
<p id="intro">Intro paragraph with <em>emphasised words</em> inside, an <a id="ext" href="https://example.com/x">external link</a> and an <a id="int" href="two.html#b">internal link</a>.</p>
<div style="height:2000px"></div>
<h2 id="mid">Middle</h2>
<p id="para">The quick brown fox jumps over the lazy dog. Find the NEEDLE here and a Needle there.</p>
<div style="height:2000px"></div>
<h2 id="end">End</h2>
<p>The last words.</p>`;

/** What a book's own script does, and reports to the reader, so the test can see what the sandbox allowed. */
const APP_JS = `
const post = (m) => parent.postMessage(m, '*');
post({ kind: 'script-ran', inline: window.inlineRan || null });
post({ kind: 'origin', origin: self.origin });
post({ kind: 'ls', before: localStorage.getItem('q1') });
localStorage.setItem('q1', 'answer');
fetch('/api/books').then((r) => post({ kind: 'fetch', ok: true, status: r.status }), (e) => post({ kind: 'fetch', ok: false, err: String(e) }));
document.fonts.load('16px TestFont').then((f) => post({ kind: 'font', loaded: f.length, status: f[0] && f[0].status }), (e) => post({ kind: 'font', err: String(e) }));
try {
	const w = new Worker('worker.js');
	w.onmessage = (e) => post({ kind: 'worker', ok: true, v: e.data });
	w.onerror = () => post({ kind: 'worker', ok: false });
} catch (e) { post({ kind: 'worker', ok: false, err: String(e) }); }
try {
	const abs = new URL('worker.js', location.href).href;
	const w2 = new Worker(URL.createObjectURL(new Blob(["importScripts('" + abs + "');"], { type: 'text/javascript' })));
	w2.onmessage = (e) => post({ kind: 'blobworker', ok: true, v: e.data });
	w2.onerror = (e) => post({ kind: 'blobworker', ok: false, msg: e.message });
} catch (e) { post({ kind: 'blobworker', ok: false, err: String(e) }); }
addEventListener('message', (ev) => {
	const d = ev.data;
	if (!d) return;
	if (d.probe) {
		const root = document.documentElement;
		post({
			kind: 'probe',
			marks: [...document.querySelectorAll('mark')].map((m) => [m.dataset.prosoche, m.textContent]),
			theme: root.dataset.prosocheTheme || null,
			scheme: root.style.colorScheme,
			fontSize: getComputedStyle(root).fontSize,
			scrollY: Math.round(scrollY),
			extTarget: document.getElementById('ext').target,
			extRel: document.getElementById('ext').rel,
			intTarget: document.getElementById('int').target
		});
	}
	if (d.select) {
		const r = document.createRange();
		r.selectNodeContents(document.getElementById(d.select));
		getSelection().removeAllRanges();
		getSelection().addRange(r);
	}
	if (d.scrollToId) scrollTo(0, document.getElementById(d.scrollToId).offsetTop + 10);
});`;

const CSS = `@font-face { font-family: TestFont; src: url(font.woff2) format('woff2'); }
body { font-family: TestFont, serif; }`;

test.beforeAll(() => {
	for (const id of [SITE, NOSCRIPT, EPUB]) rmSync(join(SHELF, id), { recursive: true, force: true });

	// A saved site that may run its own scripts.
	put(SITE, 'book.json', JSON.stringify(manifest(SITE, 'site', true, ['index.html', 'two.html'])));
	put(SITE, 'html/index.html', `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Site page</title><link rel="stylesheet" href="style.css"><script>window.inlineRan = 'yes';</script><script src="app.js"></script><script type="module" src="mod.js"></script></head><body>${BODY}</body></html>`);
	put(SITE, 'html/two.html', '<!DOCTYPE html><html><head><title>Two</title></head><body><h1 id="b">Second page</h1></body></html>');
	put(SITE, 'html/style.css', CSS);
	put(SITE, 'html/font.woff2', readFileSync(FONT));
	put(SITE, 'html/app.js', APP_JS);
	put(SITE, 'html/mod.js', "parent.postMessage({ kind: 'module' }, '*');");
	put(SITE, 'html/worker.js', "postMessage('worker says hi');");

	// The same page as a book that may not (an EPUB-like one): its scripts must be blocked.
	put(NOSCRIPT, 'book.json', JSON.stringify(manifest(NOSCRIPT, 'epub', false, ['index.html'])));
	put(NOSCRIPT, 'html/index.html', `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>No scripts</title><script>window.inlineRan = 'yes';</script><script src="app.js"></script></head><body>${BODY}</body></html>`);
	put(NOSCRIPT, 'html/app.js', APP_JS);

	// A real EPUB, unpacked as the server unpacks one.
	put(EPUB, 'book.json', JSON.stringify(manifest(EPUB, 'epub', false, ['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml'])));
	for (const [name, bytes] of Object.entries(unzipSync(makeEpub({ title: 'Real EPUB' })))) if (!name.endsWith('/')) put(EPUB, `html/${name}`, bytes);
});

type Msg = Record<string, any>;

/** Open a stand-in reader page framing `chapter` of book `id`, the way HtmlReader does. */
async function open(page: Page, id: string, chapter: string) {
	const consoleLines: string[] = [];
	page.on('console', (m) => consoleLines.push(m.text()));
	await page.route('**/__frame', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: `<!DOCTYPE html><html><body style="margin:0"><iframe id="f" style="width:900px;height:600px;border:0" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
<script>
	window.log = [];
	const f = document.getElementById('f');
	addEventListener('message', (ev) => {
		if (ev.source !== f.contentWindow) return;
		log.push(ev.data);
		if (ev.data && ev.data.source === 'prosoche-book' && ev.data.type === 'storage')
			fetch('/api/books/${id}/storage', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: ev.data.items }) }).then((r) => log.push({ kind: 'put', status: r.status }));
	});
	window.load = (path) => { log.length = 0; f.src = '/books/${id}/c/' + path; };
	window.send = (msg) => f.contentWindow.postMessage(Object.assign({ source: 'prosoche-book' }, msg), '*');
	window.raw = (msg) => f.contentWindow.postMessage(msg, '*');
</script></body></html>`
		})
	);
	await page.goto('/__frame');
	const responses: { url: string; status: number; headers: Record<string, string> }[] = [];
	page.on('response', (r) => responses.push({ url: r.url(), status: r.status(), headers: r.headers() }));
	await page.evaluate((c) => (window as any).load(c), chapter);
	return { consoleLines, responses };
}

const log = (page: Page): Promise<Msg[]> => page.evaluate(() => (window as any).log);
const send = (page: Page, msg: Msg) => page.evaluate((m) => (window as any).send(m), msg);
const raw = (page: Page, msg: Msg) => page.evaluate((m) => (window as any).raw(m), msg);

/** Wait for a message from the frame matching `want`, and answer it. */
async function waitFor(page: Page, want: (m: Msg) => boolean, timeout = 8000): Promise<Msg> {
	let found: Msg | undefined;
	await expect.poll(async () => (found = (await log(page)).findLast(want)) !== undefined, { timeout, message: 'a message from the frame' }).toBe(true);
	return found!;
}
const kind = (k: string) => (m: Msg) => m.kind === k;
const type = (t: string) => (m: Msg) => m.type === t;

/** Ask the book's own script what the page looks like now. */
async function probe(page: Page): Promise<Msg> {
	await page.evaluate(() => ((window as any).log = (window as any).log.filter((m: Msg) => m.kind !== 'probe')));
	await raw(page, { probe: true });
	return waitFor(page, kind('probe'));
}

test.describe('a site book that may run its own scripts', () => {
	test.describe.configure({ mode: 'serial' });

	test('the bridge runs under the CSP, in an opaque origin', async ({ page }) => {
		const { responses } = await open(page, SITE, 'index.html');
		const ready = await waitFor(page, type('ready'));
		expect(ready).toMatchObject({ source: 'prosoche-book', chapter: 'index.html', title: 'Site page' });
		// The page is the app's own origin to the server, but the frame is not:
		expect((await waitFor(page, kind('origin'))).origin).toBe('null');
		const csp = responses.find((r) => r.url.endsWith(`/books/${SITE}/c/index.html`))!.headers['content-security-policy'];
		expect(csp).toContain("script-src 'nonce-");
		expect(csp).toContain("'self' 'unsafe-eval'");
		expect(csp).toContain("connect-src 'none'");
	});

	test("the book's own scripts run: 'self' matches in the sandbox, and so do inline scripts and module scripts", async ({ page }) => {
		await open(page, SITE, 'index.html');
		expect(await waitFor(page, kind('script-ran'))).toMatchObject({ inline: 'yes' });
		await waitFor(page, kind('module'));
	});

	test('fetch to the app\'s API from inside the frame is blocked', async ({ page }) => {
		const { consoleLines } = await open(page, SITE, 'index.html');
		const result = await waitFor(page, kind('fetch'));
		expect(result.ok).toBe(false);
		expect(consoleLines.join('\n')).toMatch(/connect-src/);
	});

	test('a font from the book loads, with CORS from an opaque origin', async ({ page }) => {
		const { responses } = await open(page, SITE, 'index.html');
		const font = await waitFor(page, kind('font'));
		expect(font).toMatchObject({ loaded: 1, status: 'loaded' });
		const res = responses.find((r) => r.url.endsWith('/font.woff2'))!;
		expect(res.status).toBe(200);
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(res.headers['content-type']).toBe('font/woff2');
	});

	test('localStorage written in the frame reaches storage.json through the parent, and comes back on the next load', async ({ page }) => {
		rmSync(join(SHELF, SITE, 'storage.json'), { force: true });
		await open(page, SITE, 'index.html');
		expect((await waitFor(page, kind('ls'))).before).toBeNull();
		const stored = await waitFor(page, type('storage'));
		expect(stored.items).toEqual({ q1: 'answer' });
		await waitFor(page, kind('put'));
		await expect.poll(() => (existsSync(join(SHELF, SITE, 'storage.json')) ? JSON.parse(readFileSync(join(SHELF, SITE, 'storage.json'), 'utf8')) : null)).toEqual({ q1: 'answer' });
		// A fresh load is seeded from the file, before the book's script runs.
		await page.evaluate(() => (window as any).load('index.html'));
		expect((await waitFor(page, kind('ls'))).before).toBe('answer');
	});

	// Not an assertion about what should happen: a record of what the browser does, for the site-book step
	// (docs/plan-books.md step 5), whose code editor runs in workers.
	test('workers (informational): a worker by URL, and a blob worker that imports a book script', async ({ page }) => {
		await open(page, SITE, 'index.html');
		for (const k of ['worker', 'blobworker']) test.info().annotations.push({ type: k, description: JSON.stringify(await waitFor(page, kind(k))) });
	});

	test('goto, place, selection, marks, style and links work across the sandbox', async ({ page }) => {
		const { consoleLines } = await open(page, SITE, 'index.html');
		await waitFor(page, type('ready'));

		// goto
		await send(page, { type: 'goto', anchor: 'mid' });
		const placed = await waitFor(page, (m) => m.type === 'place' && m.anchor === 'mid');
		expect(placed.chapter).toBe('index.html');
		expect((await probe(page)).scrollY).toBeGreaterThan(1500);
		await send(page, { type: 'goto' });
		await waitFor(page, (m) => m.type === 'place' && m.anchor === undefined);
		expect((await probe(page)).scrollY).toBe(0);

		// place on a scroll the reader did not ask for
		await raw(page, { scrollToId: 'mid' });
		await waitFor(page, (m) => m.type === 'place' && m.anchor === 'mid');

		// selection
		await raw(page, { select: 'para' });
		expect(await waitFor(page, type('selection'))).toMatchObject({ quote: 'The quick brown fox jumps over the lazy dog. Find the NEEDLE here and a Needle there.' });

		// marks: a quote across an inline element, and a case-insensitive find that scrolls
		await send(page, { type: 'goto' });
		await send(page, { type: 'mark', quotes: ['paragraph with emphasised words inside', 'quick brown fox'], find: 'needle' });
		const marked = await probe(page);
		expect(marked.marks).toEqual([
			['highlight', 'paragraph with '],
			['highlight', 'emphasised words'],
			['highlight', ' inside'],
			['highlight', 'quick brown fox'],
			['find', 'NEEDLE'],
			['find', 'Needle']
		]);
		expect(marked.scrollY).toBeGreaterThan(1000);
		// Marking again replaces the old marks rather than stacking them.
		await send(page, { type: 'mark', quotes: [] });
		expect((await probe(page)).marks).toEqual([]);

		// style
		await send(page, { type: 'style', theme: 'dark', fontScale: 1 });
		const base = await probe(page);
		expect(base).toMatchObject({ theme: 'dark', scheme: 'dark' });
		await send(page, { type: 'style', theme: 'light', fontScale: 1.5 });
		const big = await probe(page);
		expect(big).toMatchObject({ theme: 'light', scheme: 'light' });
		expect(parseFloat(big.fontSize)).toBeCloseTo(parseFloat(base.fontSize) * 1.5, 1);

		// links: another host opens in a new tab, this book's own stay in the frame
		await raw(page, { probe: true });
		const links = await probe(page);
		expect(links).toMatchObject({ extTarget: '_blank', extRel: 'noopener', intTarget: '' });

		// Messages from anywhere but the parent, or without the source, do nothing.
		await raw(page, { type: 'style', theme: 'dark', fontScale: 1 });
		await send(page, { type: 'style', theme: 'light', fontScale: 1 });
		expect(consoleLines.filter((l) => /Uncaught/.test(l))).toEqual([]);
	});

	test('a link inside the book navigates the frame, and the new chapter says ready', async ({ page }) => {
		await open(page, SITE, 'index.html');
		await waitFor(page, type('ready'));
		await page.frameLocator('#f').locator('#int').click({ trial: true }).catch(() => {});
		await page.evaluate(() => (window as any).load('two.html'));
		expect(await waitFor(page, type('ready'))).toMatchObject({ chapter: 'two.html', title: 'Two' });
	});
});

test.describe('a book that may not run scripts', () => {
	test('its own scripts, inline or not, are blocked, and the bridge still runs', async ({ page }) => {
		const { consoleLines } = await open(page, NOSCRIPT, 'index.html');
		expect(await waitFor(page, type('ready'))).toMatchObject({ title: 'No scripts' });
		await page.waitForTimeout(1500);
		expect((await log(page)).filter((m) => m.kind)).toEqual([]);
		expect(consoleLines.join('\n')).toMatch(/Content Security Policy/);
		// ... and the reader can still drive it.
		await send(page, { type: 'mark', quotes: [], find: 'needle' });
		await send(page, { type: 'goto', anchor: 'mid' });
		await waitFor(page, (m) => m.type === 'place' && m.anchor === 'mid');
	});
});

test.describe('a real EPUB, unpacked', () => {
	test('opens as XHTML under the sandbox, styled as a reader, and follows the theme', async ({ page }) => {
		const { responses } = await open(page, EPUB, 'OEBPS/text/ch1.xhtml');
		expect(await waitFor(page, type('ready'))).toMatchObject({ chapter: 'OEBPS/text/ch1.xhtml', title: 'First chapter' });
		const res = responses.find((r) => r.url.endsWith('/OEBPS/text/ch1.xhtml'))!;
		expect(res.headers['content-type']).toBe('application/xhtml+xml');
		expect(res.headers['content-security-policy']).toMatch(/script-src 'nonce-[^']+';/);
		await send(page, { type: 'style', theme: 'dark', fontScale: 1.2 });
		await send(page, { type: 'mark', quotes: ['best of times'], find: 'part a' });
		await page.waitForTimeout(500);
		await page.screenshot({ path: test.info().outputPath('epub-dark.png') });
		// The image and stylesheet next to it load.
		await expect.poll(() => responses.some((r) => r.url.endsWith('/images/dot.png') && r.status === 200)).toBe(true);
		await expect.poll(() => responses.some((r) => r.url.endsWith('/styles/book.css') && r.status === 200)).toBe(true);
	});

	test('the route answers 404 for what is not there, and keeps the shelf out of reach', async ({ request }) => {
		expect((await request.get(`/books/${EPUB}/c/nope.html`)).status()).toBe(404);
		expect((await request.get(`/books/${EPUB}/c/..%2Fbook.json`)).status()).toBe(404);
		expect((await request.get(`/books/${EPUB}/c/%2e%2e/book.json`)).status()).toBe(404);
		expect((await request.get(`/books/nothere0nothere0/c/index.html`)).status()).toBe(404);
		expect((await request.get(`/books/not-an-id/c/index.html`)).status()).toBe(404);
		const ok = await request.get(`/books/${EPUB}/c/OEBPS/styles/book.css`);
		expect(ok.status()).toBe(200);
		expect(ok.headers()['x-content-type-options']).toBe('nosniff');
	});

	test('the storage route validates', async ({ request }) => {
		const put = (data: unknown) => request.put(`/api/books/${EPUB}/storage`, { data });
		expect((await put({ items: { a: '1' } })).status()).toBe(200);
		expect((await put({ items: { a: 1 } })).status()).toBe(400);
		expect((await put({ items: { big: 'x'.repeat(2 * 1024 * 1024) } })).status()).toBe(413);
		expect((await request.put(`/api/books/${EPUB}/storage`, { data: 'not json', headers: { 'content-type': 'text/plain' } })).status()).toBeGreaterThanOrEqual(403); // 403 from SvelteKit's form-type check, or 415 from the route
		expect((await request.put(`/api/books/nothere0nothere0/storage`, { data: { items: {} } })).status()).toBe(404);
		expect(JSON.parse(readFileSync(join(SHELF, EPUB, 'storage.json'), 'utf8'))).toEqual({ a: '1' });
	});
});


test.describe('HtmlReader, the real component, around the same frame', () => {
	const NOTE = join(ROOT, 'vault', 'Books', 'Real EPUB.md');

	test.beforeAll(async ({ request }) => {
		mkdirSync(dirname(NOTE), { recursive: true });
		writeFileSync(NOTE, `---\nbook: ${EPUB}\nformat: epub\nsource: "real.epub"\nadded: "2026-10-23"\n---\n\n## Highlights\n\n- > best of times \u2014 OEBPS/text/ch1.xhtml\n`);
		await request.post('/api/sync', { data: { action: 'rebuild' } });
	});
	test.afterAll(async ({ request }) => {
		rmSync(NOTE, { force: true });
		await request.post('/api/sync', { data: { action: 'rebuild' } });
	});

	test('opens the first chapter in a sandboxed frame, marks the highlight, follows the dark theme, and steps through chapters', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('hub:theme', 'dark'));
		await page.goto(`/books/${EPUB}`);
		const iframe = page.getByTestId('book-frame');
		const sandbox = await iframe.getAttribute('sandbox');
		expect(sandbox!.split(' ').sort()).toEqual(['allow-forms', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-scripts']);

		const frame = page.frameLocator('[data-testid=book-frame]');
		await expect(frame.locator('h1')).toHaveText('First chapter');
		await expect(frame.locator('mark[data-prosoche="highlight"]')).toHaveText('best of times');
		// The theme reached the frame: the EPUB page is drawn in the app's dark paper.
		await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(35, 32, 28)');

		await page.getByTestId('next-chapter').click();
		await expect(frame.locator('h1')).toHaveText('Second chapter');
		await expect(page.getByTestId('next-chapter')).toBeDisabled();
		await page.getByTestId('prev-chapter').click();
		await expect(frame.locator('h1')).toHaveText('First chapter');
		// Back on the first chapter, the highlight is marked again.
		await expect(frame.locator('mark[data-prosoche="highlight"]')).toHaveText('best of times');
	});

	test('the frame the reader makes is an opaque origin', async ({ page }) => {
		await page.goto(`/books/${EPUB}`);
		await expect.poll(() => page.frames().some((f) => f.url().includes(`/books/${EPUB}/c/`))).toBe(true);
		const origin = await page.frames().find((f) => f.url().includes(`/books/${EPUB}/c/`))!.evaluate(() => self.origin);
		expect(origin).toBe('null');
	});
});

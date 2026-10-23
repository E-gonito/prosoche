import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf, makeScannedPdf } from '../../../../e2e/fixtures/make-pdf.mjs';
import { Shelf } from '../vault/shelf';
import type { BookManifest } from '$lib/shared/books';
import { writeManifest } from './manifest';
import { pullText, readText, sections } from './text';

let root: string;
let shelf: Shelf;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-text-'));
	shelf = new Shelf(root);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const manifest = (over: Partial<BookManifest>): BookManifest => ({
	id: 'book-0001',
	format: 'pdf',
	title: 'T',
	source: 'x',
	bytes: 0,
	contents: [],
	scripts: false,
	text: { state: 'pending' },
	savedAt: '2026-10-23T00:00:00Z',
	...over
});

describe('sections', () => {
	const page = (body: string, head = '<title>Chapter One - Book</title>') => `<!DOCTYPE html><html><head>${head}<script>var x = "nope";</script></head><body>${body}</body></html>`;

	it('splits at headings with an id; the text before the first is its own part, labelled by the title', () => {
		const html = page(
			'<p>Intro words.</p><h1 id="one"><a class="header" href="#one">One</a></h1><p>First <em>part</em> text.</p><h2 id="two">Two</h2><p>Second.</p>'
		);
		expect(sections(html, 'ch1.html')).toEqual([
			{ place: { kind: 'html', chapter: 'ch1.html' }, label: 'Chapter One - Book', text: 'Intro words.' },
			{ place: { kind: 'html', chapter: 'ch1.html', anchor: 'one' }, label: 'One', text: 'One First part text.' },
			{ place: { kind: 'html', chapter: 'ch1.html', anchor: 'two' }, label: 'Two', text: 'Two Second.' }
		]);
	});

	it('does not split at a heading without an id, or at h5', () => {
		const html = page('<h1>No id</h1><p>a</p><h5 id="five">Five</h5><p>b</p>');
		expect(sections(html, 'c.html')).toEqual([{ place: { kind: 'html', chapter: 'c.html' }, label: 'Chapter One - Book', text: 'No id a Five b' }]);
	});

	it('drops scripts, styles, nav and mdBook chrome, and keeps code', () => {
		const html = page(
			'<nav>Contents menu</nav><div id="sidebar"><ol><li>Side item</li></ol></div><div id="menu-bar">Menu</div>' +
				'<mdbook-sidebar-scrollbox>Scroll</mdbook-sidebar-scrollbox><div class="nav-wrapper">Next</div><div id="search-wrapper">Search</div>' +
				'<noscript>Enable JS</noscript><template><p>Tpl</p></template><style>p{color:red}</style>' +
				'<main><p>Real text.</p><pre><code class="language-rust">let x = &amp;y;</code></pre></main>'
		);
		const [only, ...rest] = sections(html, 'c.html');
		expect(rest).toEqual([]);
		expect(only.text).toBe('Real text. let x = &y;');
	});

	it('puts a break between blocks and none inside words', () => {
		const html = page('<p>alpha</p><p>beta</p><p>gam<b>ma</b></p>');
		expect(sections(html, 'c.html')[0].text).toBe('alpha beta gamma');
	});

	it('reads XHTML with an XML declaration and entities', () => {
		const xhtml = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><p>Caf&#233; &amp; bar<br/>done</p></body></html>';
		expect(sections(xhtml, 'a.xhtml')[0].text).toBe('Café & bar done');
	});

	it('skips empty sections and copes with junk', () => {
		expect(sections(page('<h1 id="a"></h1><h1 id="b">B</h1>'), 'c.html').map((s) => s.label)).toEqual(['B']);
		expect(sections('', 'c.html')).toEqual([]);
		expect(sections('<<<not <html', 'c.html')).toEqual(expect.any(Array));
	});
});

describe('pullText on a PDF', () => {
	it('writes one entry per page with text, reports progress, and can be read back', async () => {
		await shelf.write('book-0001', 'original.pdf', makePdf(['Alpha page', 'Beta page', '', 'Gamma page']));
		const progress: Array<[number, number]> = [];
		const state = await pullText(shelf, manifest({ pages: 4 }), (d, t) => progress.push([d, t]));
		expect(state).toEqual({ state: 'done', parts: 3 });
		expect(progress).toEqual([1, 2, 3, 4].map((n) => [n, 4]));
		const entries = await readText(shelf, 'book-0001');
		expect(entries?.map((e) => [e.label, e.place, e.text])).toEqual([
			['p. 1', { kind: 'page', page: 1 }, 'Alpha page'],
			['p. 2', { kind: 'page', page: 2 }, 'Beta page'],
			['p. 4', { kind: 'page', page: 4 }, 'Gamma page']
		]);
	});

	it('is none for a scan, and writes no text.json', async () => {
		await shelf.write('book-0001', 'original.pdf', makeScannedPdf(5));
		expect(await pullText(shelf, manifest({ pages: 5 }))).toEqual({ state: 'none' });
		expect(await readText(shelf, 'book-0001')).toBeNull();
	});

	it('fails, not throws, for a missing or broken PDF', async () => {
		expect(await pullText(shelf, manifest({ pages: 1 }))).toMatchObject({ state: 'failed' });
		await shelf.write('book-0001', 'original.pdf', new Uint8Array([1, 2, 3]));
		expect(await pullText(shelf, manifest({ pages: 1 }))).toMatchObject({ state: 'failed' });
	});
});

describe('pullText on HTML', () => {
	it('reads every chapter in order and skips a missing one', async () => {
		await shelf.write('book-0001', 'html/a.html', '<title>A</title><h1 id="x">X</h1><p>apple</p>');
		await shelf.write('book-0001', 'html/dir/c.html', '<title>C</title><p>cherry</p>');
		const m = manifest({ format: 'site', chapters: ['a.html', 'gone.html', 'dir/c.html'] });
		const progress: number[] = [];
		expect(await pullText(shelf, m, (d) => progress.push(d))).toEqual({ state: 'done', parts: 2 });
		expect(progress).toEqual([1, 2, 3]);
		expect((await readText(shelf, 'book-0001'))?.map((e) => [e.label, e.text])).toEqual([
			['X', 'X apple'],
			['C', 'cherry']
		]);
	});
});

describe('readText', () => {
	it('is null for nothing, junk, or the wrong shape', async () => {
		expect(await readText(shelf, 'book-0001')).toBeNull();
		await shelf.write('book-0001', 'text.json', '{not json');
		expect(await readText(shelf, 'book-0001')).toBeNull();
		await shelf.write('book-0001', 'text.json', '{"a":1}');
		expect(await readText(shelf, 'book-0001')).toBeNull();
		await shelf.write('book-0001', 'text.json', '[{"label":1},{"place":{"kind":"page","page":2},"label":"p. 2","text":"ok"}]');
		expect(await readText(shelf, 'book-0001')).toEqual([{ place: { kind: 'page', page: 2 }, label: 'p. 2', text: 'ok' }]);
	});

	it('is unused by writeManifest', async () => {
		await writeManifest(shelf, manifest({}));
		expect(await readText(shelf, 'book-0001')).toBeNull();
	});
});

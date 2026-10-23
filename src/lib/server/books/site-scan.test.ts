import { describe, expect, it } from 'vitest';
import { bookTitle, readToc, scanCss, scanHtml, scanScript, tocHtmlFromScript, tocScriptUrl, replaceSpans } from './site-scan';

const PAGE = 'https://books.test/b/index.html';

describe('readToc', () => {
	it('flattens nesting into depths, keeps numbers in titles, drops unlinked drafts', () => {
		const html = `<ol class="chapter">
			<li class="chapter-item"><a href="intro.html">Intro</a></li>
			<li class="part-title">Part A</li>
			<li class="chapter-item"><span class="chapter-link-wrapper"><a href="c1.html"><strong aria-hidden="true">1.</strong> One &amp; More</a></span>
				<ol class="section"><li class="chapter-item"><a href="c1-1.html#top"><strong>1.1.</strong> Sub</a></li>
				<li class="chapter-item"><span><strong>1.2.</strong> A draft</span></li></ol></li>
			<li class="chapter-item"><a href="c2.html">Two</a></li>
		</ol>`;
		expect(readToc(html, PAGE)).toEqual([
			{ kind: 'chapter', title: 'Intro', href: 'https://books.test/b/intro.html', depth: 0 },
			{ kind: 'part', title: 'Part A' },
			{ kind: 'chapter', title: '1. One & More', href: 'https://books.test/b/c1.html', depth: 0 },
			{ kind: 'chapter', title: '1.1. Sub', href: 'https://books.test/b/c1-1.html#top', depth: 1 },
			{ kind: 'chapter', title: 'Two', href: 'https://books.test/b/c2.html', depth: 0 }
		]);
	});

	it('reads the older shape, where a section list sits in an li of its own', () => {
		const html = `<ol class="chapter"><li><a href="a.html">A</a><a class="toggle"><div>❱</div></a></li><li><ol class="section"><li><a href="a1.html">A1</a></li><li><ol class="section"><li><a href="a1x.html">A1x</a></li></ol></li></ol></li><li><a href="b.html">B</a></li></ol>`;
		expect(readToc(html, PAGE)!.map((i) => (i.kind === 'chapter' ? `${i.depth}:${i.title}` : i.title))).toEqual(['0:A', '1:A1', '2:A1x', '0:B']);
	});

	it('copes with list items whose end tags are missing, as mdBook writes them', () => {
		const html = '<ol class="chapter"><li class="chapter-item"><a href="a.html">A</a><ol class="section"><li><a href="a1.html">A1</a></li></ol><li class="chapter-item"><a href="b.html">B</a></li></ol>';
		expect(readToc(html, PAGE)!.map((i) => (i.kind === 'chapter' ? `${i.depth}:${i.title}` : i.title))).toEqual(['0:A', '1:A1', '0:B']);
	});

	it('is null without an ol.chapter', () => {
		expect(readToc('<html><body><ol><li>x</li></ol></body></html>', PAGE)).toBeNull();
		expect(readToc('', PAGE)).toBeNull();
	});
});

describe('the contents script', () => {
	it.each([
		['<script src="toc.js"></script>', 'https://books.test/b/toc.js'],
		['<script src="toc-3119a861.js"></script>', 'https://books.test/b/toc-3119a861.js'],
		['<script src="js/toc-ab.js?v=2"></script>', 'https://books.test/b/js/toc-ab.js?v=2'],
		['<script src="book-3119a861.js"></script>', null],
		['<script src="autotoc.js"></script>', null],
		['<p>no scripts</p>', null]
	])('finds the script in %s', (html, want) => expect(tocScriptUrl(html, PAGE)).toBe(want));

	it('reads the assigned string, undoing escapes, and ignores other assignments', () => {
		const js = `class X extends HTMLElement { connectedCallback() { this.innerHTML = '<ol class="chapter"><li><a href="a.html">It\\'s A &amp; B</a></li>\\n<li><a href="b.html">\\u00e9</a></li></ol>'; } }
			const debug = document.createElement('div'); debug.innerHTML = \`<table>\${x}</table>\`;`;
		const html = tocHtmlFromScript(js)!;
		expect(html).toContain("It's A &amp; B");
		expect(html).toContain('é');
		expect(readToc(html, PAGE)!.length).toBe(2);
	});

	it('joins a string written in pieces', () => {
		expect(tocHtmlFromScript(`this.innerHTML = '<ol class="chapter">' + "<li><a href='a.html'>A</a></li>" + '</ol>';`)).toBe(`<ol class="chapter"><li><a href='a.html'>A</a></li></ol>`);
	});

	it.each(['', 'this.innerHTML = "<p>no list</p>";', 'this.innerHTML = `<ol class="chapter"></ol>`;', "this.innerHTML = 'unterminated"])('answers null for %j', (js) => expect(tocHtmlFromScript(js)).toBeNull());
});

describe('bookTitle', () => {
	it.each([
		["What's Different - The Rust Book", 'Foreword - The Rust Book', 'x', 'The Rust Book'],
		['A - B - The Book', 'C - The Book', 'x', 'The Book'],
		['Old Almanac', 'Introduction - Old Almanac', 'x', 'Old Almanac'],
		['Intro - Book One', 'Chapter - Book Two', 'x', 'Intro - Book One'],
		['', '', 'books.test', 'books.test']
	])('%j and %j give %j', (index, chapter, fallback, want) => expect(bookTitle(index, chapter, fallback)).toBe(want));
});

describe('scanHtml', () => {
	const html = `<html><head><title>T</title>
<link rel="stylesheet" href="css/a.css"><link rel="icon" href="/fav.png"><link rel="alternate" href="feed.xml"><link rel="canonical" href="https://other.test/">
<script src="js/a.js"></script><script>var x = "inline.js";</script>
<style>body { background: url(bg.png) }</style></head>
<body><img src="img/p.png" srcset="img/p.png 1x, img/p2.png 2x" alt="x" style="background:url('s.png')">
<a href="c2.html#sec">next</a><a href="#top">top</a><a href="mailto:a@b.c">m</a><a href="data:text/plain,hi">d</a>
<video poster=img/poster.jpg src='v.mp4'></video></body></html>`;
	const scan = scanHtml(html, PAGE);

	it('finds what loads and what is linked, as absolute addresses without fragments', () => {
		expect(scan.refs.map((r) => `${r.anchor ? 'a' : 'r'} ${r.url}`)).toEqual([
			'r https://books.test/b/css/a.css',
			'r https://books.test/fav.png',
			'r https://books.test/b/js/a.js',
			'r https://books.test/b/img/p.png',
			'r https://books.test/b/img/p.png',
			'r https://books.test/b/img/p2.png',
			'a https://books.test/b/c2.html',
			'r https://books.test/b/v.mp4',
			'r https://books.test/b/img/poster.jpg'
		]);
		expect(scan.refs.find((r) => r.anchor)!.hash).toBe('#sec');
		expect(scan.scripts).toEqual(['var x = "inline.js";']);
		expect(scan.styles.length).toBe(2);
	});

	it('reports spans that cut out exactly the value, quoted or not', () => {
		for (const r of scan.refs.filter((r) => r.rewritable)) expect(html.slice(r.start, r.end)).toBe(r.value);
		expect(scan.refs.filter((r) => !r.rewritable).length).toBe(2); // the srcset entries
	});

	it('replaces by span without touching anything else', () => {
		const css = scan.refs.find((r) => r.value === 'css/a.css')!;
		const out = replaceSpans(html, [{ start: css.start, end: css.end, text: 'x/a.css' }]);
		expect(out).toBe(html.replace('css/a.css', 'x/a.css'));
	});
});

describe('scanCss', () => {
	it('finds url() in every quoting and @import, skips data, fragments and comments', () => {
		const css = `@import "theme.css"; @import url('p.css') print;
			@font-face { src: url("../fonts/a.woff2") format("woff2"), url(../fonts/a.woff) format("woff"); }
			/* url(commented.png) */
			a { background: url( x/y.png ) } b { filter: url(#threshold); background: url(data:image/png;base64,AAAA) }
			c { background: url('data:image/svg+xml, <svg xmlns="http://www.w3.org/2000/svg"></svg>') }`;
		const refs = scanCss(css, 'https://books.test/b/css/main.css');
		expect(refs.map((r) => r.url)).toEqual([
			'https://books.test/b/css/theme.css',
			'https://books.test/b/css/p.css',
			'https://books.test/b/fonts/a.woff2',
			'https://books.test/b/fonts/a.woff',
			'https://books.test/b/css/x/y.png'
		]);
		for (const r of refs) expect(css.slice(r.start, r.end)).toBe(r.value);
	});
});

describe('scanScript', () => {
	const bases = ['https://books.test/b/quiz/', 'https://books.test/b/'];
	const origin = 'https://books.test';

	it('finds names in plain, template and URL() forms against each base', () => {
		const js = `const base = "./quiz"; new Worker(\`\${base}/ra-worker.js\`); new URL("wasm_demo_bg.wasm", "https://books.test/b/quiz/"); load('searchindex-9f.js'); x = "text/css"; y = ".js"; z = "application/json";`;
		const got = scanScript(js, bases, origin);
		expect(got).toContain('https://books.test/b/quiz/ra-worker.js');
		expect(got).toContain('https://books.test/b/ra-worker.js');
		expect(got).toContain('https://books.test/b/quiz/wasm_demo_bg.wasm');
		expect(got).toContain('https://books.test/b/searchindex-9f.js');
		expect(got.some((u) => /text\/css|application\/json/.test(u))).toBe(false);
	});

	it('takes whole same-origin addresses as they are and ignores other origins', () => {
		const js = `fetch("https://books.test/data/x.json"); fetch("https://other.test/y.json"); a = "https://books.test/data/";`;
		const got = scanScript(js, bases, origin);
		expect(got).toContain('https://books.test/data/x.json');
		expect(got.some((u) => u.includes('other.test'))).toBe(false);
	});

	it('is bounded', () => {
		const js = Array.from({ length: 1000 }, (_, i) => `"f${i}.json"`).join(';');
		expect(scanScript(js, bases, origin, 50).length).toBe(50);
	});
});

/**
 * Reading the parts of a saved site: its table of contents, and what each
 * page, stylesheet and script refers to. All pure: text in, facts out, so
 * `site.ts` can stay about fetching and keeping, and these can be
 * table-tested against invented pages.
 *
 * What an mdBook looks like is known only here. Two shapes of contents:
 *
 *  - Old (before 0.4.41): `<nav id="sidebar">` holds `ol.chapter` in every
 *    page.
 *  - New: the pages hold an empty sidebar and a script, `toc.js` or
 *    `toc-<hash>.js`, that sets `this.innerHTML = '<ol class="chapter">…'`.
 *    `toc.html` holds the same list for browsers without scripts.
 */

import { HTMLElement, parse } from 'node-html-parser';

/** One line of a book's table of contents as found, before it is checked against the files. */
export type TocItem =
	| { kind: 'part'; title: string }
	| { kind: 'chapter'; title: string; /** Absolute, with any `#anchor` kept. */ href: string; depth: number };

/**
 * The table of contents in `html`: the first `ol.chapter`, flattened in
 * reading order with each link's depth from `ol` nesting (a top-level
 * chapter is 0, its sections 1). Handles a nested `ol` inside a chapter's
 * `li` and one in a `li` of its own, which are the two shapes mdBook has
 * produced. Section numbers stay in the title ("4.1. What Is Ownership?"),
 * because that is how the book's own sidebar reads. A line without a link (a
 * draft chapter) is left out. Null when the page has no `ol.chapter`. Never
 * throws.
 */
export function readToc(html: string, pageUrl: string): TocItem[] | null {
	const list = parse(html).querySelector('ol.chapter');
	if (!list) return null;
	const out: TocItem[] = [];
	walk(list, 0);
	return out;

	function walk(ol: HTMLElement, depth: number): void {
		for (const child of ol.childNodes) {
			if (!(child instanceof HTMLElement)) continue;
			const tag = child.tagName?.toLowerCase();
			if (tag === 'ol') {
				walk(child, depth + 1);
			} else if (tag === 'li') {
				if (child.classList.contains('part-title')) {
					const title = squash(child.text);
					if (title) out.push({ kind: 'part', title });
					continue;
				}
				const link = linkOf(child);
				const href = link?.getAttribute('href');
				if (link && href) {
					const abs = resolve(href, pageUrl);
					const title = squash(link.text);
					if (abs && title) out.push({ kind: 'chapter', title, href: abs, depth });
				}
				for (const nested of child.childNodes) {
					if (nested instanceof HTMLElement && nested.tagName?.toLowerCase() === 'ol') walk(nested, depth + 1);
				}
			}
		}
	}
}

/** A list item's own link: the first `a` that is not a fold toggle and not inside a nested list. */
function linkOf(li: HTMLElement): HTMLElement | undefined {
	return li.querySelectorAll('a').find((a) => {
		if (a.classList.contains('toggle') || a.classList.contains('chapter-fold-toggle')) return false;
		for (let p = a.parentNode as HTMLElement | null; p && p !== li; p = p.parentNode as HTMLElement | null) {
			if (p.tagName?.toLowerCase() === 'ol') return false;
		}
		return !!a.getAttribute('href');
	});
}

/** The address of the page's table-of-contents script (`toc.js`, `toc-<hash>.js`), or null. */
export function tocScriptUrl(html: string, pageUrl: string): string | null {
	for (const s of parse(html).querySelectorAll('script[src]')) {
		const src = s.getAttribute('src') ?? '';
		if (/(?:^|\/)toc(?:-[\w]+)?\.js(?:[?#].*)?$/i.test(src)) return resolve(src, pageUrl);
	}
	return null;
}

/**
 * The HTML a table-of-contents script assigns to `innerHTML`: the first
 * quoted string (or `'a' + 'b'` run of them) that holds an `ol` of class
 * `chapter`, with its escapes undone. The script is read, never run. Null
 * when it assigns no such string.
 */
export function tocHtmlFromScript(js: string): string | null {
	const assign = /\.innerHTML\s*=\s*(?=['"])/g;
	for (let m = assign.exec(js); m; m = assign.exec(js)) {
		let at = m.index + m[0].length;
		let text = '';
		for (;;) {
			const lit = readJsString(js, at);
			if (!lit) break;
			text += lit.value;
			at = lit.end;
			const more = /^\s*\+\s*(?=['"])/.exec(js.slice(at, at + 20));
			if (!more) break;
			at += more[0].length;
		}
		if (/<ol[^>]*\bchapter\b/.test(text)) return text;
	}
	return null;
}

/** A single- or double-quoted JavaScript string starting at `from`, decoded, and where it ends. Null if unterminated. */
function readJsString(src: string, from: number): { value: string; end: number } | null {
	const quote = src[from];
	if (quote !== "'" && quote !== '"') return null;
	let out = '';
	for (let i = from + 1; i < src.length; i++) {
		const c = src[i];
		if (c === quote) return { value: out, end: i + 1 };
		if (c === '\n') return null;
		if (c !== '\\') {
			out += c;
			continue;
		}
		const n = src[++i];
		if (n === 'n') out += '\n';
		else if (n === 't') out += '\t';
		else if (n === 'r') out += '\r';
		else if (n === 'b') out += '\b';
		else if (n === 'f') out += '\f';
		else if (n === 'v') out += '\v';
		else if (n === '0') out += '\0';
		else if (n === 'x' && /^[0-9a-f]{2}$/i.test(src.slice(i + 1, i + 3))) {
			out += String.fromCharCode(parseInt(src.slice(i + 1, i + 3), 16));
			i += 2;
		} else if (n === 'u' && /^[0-9a-f]{4}$/i.test(src.slice(i + 1, i + 5))) {
			out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
			i += 4;
		} else if (n === 'u' && src[i + 1] === '{') {
			const close = src.indexOf('}', i);
			const cp = parseInt(src.slice(i + 2, close), 16);
			if (close < 0 || !Number.isInteger(cp) || cp > 0x10ffff) return null;
			out += String.fromCodePoint(cp);
			i = close;
		} else if (n === '\n') {
			// a line continuation
		} else out += n;
	}
	return null;
}

/** A page's `<title>`, entities decoded and whitespace squashed; empty when it has none. */
export function pageTitle(html: string): string {
	return squash(parse(html).querySelector('title')?.text ?? '');
}

/**
 * The book's title from the titles of its pages. mdBook titles a page
 * "<chapter> - <book>", so when the index page and the first chapter agree on
 * what follows the last " - ", that is the book's title ("The Rust
 * Programming Language", not "What's Different About This Book?"). When they
 * do not, or a page has no " - ", the index page's whole title stands, and
 * `fallback` when there is none.
 */
export function bookTitle(indexTitle: string, chapterTitle: string, fallback: string): string {
	const tail = (t: string) => {
		const i = t.lastIndexOf(' - ');
		return i > 0 ? t.slice(i + 3).trim() : '';
	};
	const a = tail(indexTitle);
	if (a && a === tail(chapterTitle)) return a;
	return indexTitle || fallback;
}

// ---------------------------------------------------------------------------
// What a page refers to

/** One address in a page or stylesheet, with where its text sits so it can be replaced in place. */
export interface Ref {
	/** The attribute's value as written, entities decoded. */
	value: string;
	/** Absolute, with the `#fragment` dropped. */
	url: string;
	/** `#fragment` of the value, with the `#`, or empty. */
	hash: string;
	/** The value's character span in the source text. */
	start: number;
	end: number;
	/** A `<a href>`: a link to follow, not something the page needs to load. */
	anchor: boolean;
	/** False where the value is a list (`srcset`) the page does not rewrite. */
	rewritable: boolean;
}

export interface PageScan {
	refs: Ref[];
	/** The text of `<style>` blocks and `style=""` attributes, each with refs to read but not to rewrite. */
	styles: string[];
	/** The text of inline `<script>`s, for `scanScript`. */
	scripts: string[];
}

const LINK_RELS_THAT_LOAD = new Set(['stylesheet', 'icon', 'shortcut', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'manifest', 'preload', 'modulepreload', 'mask-icon']);

/**
 * Everything in an HTML page that points somewhere: scripts, stylesheets,
 * icons, images (and their `srcset`), media, objects, frames and links,
 * the CSS in `<style>` and `style=""`, and inline scripts. Addresses are
 * made absolute against `pageUrl`. Skips `#fragment`, `data:`, `javascript:`
 * and `mailto:` values. Reads; never changes `html`. Never throws.
 */
export function scanHtml(html: string, pageUrl: string): PageScan {
	const root = parse(html);
	const refs: Ref[] = [];
	const styles: string[] = [];
	const scripts: string[] = [];

	const add = (el: HTMLElement, attr: string, anchor: boolean, list = false) => {
		const value = el.getAttribute(attr);
		if (!value) return;
		const span = attrSpan(html, el.range[0], attr);
		if (list) {
			for (const part of value.split(/,\s+/)) {
				const first = part.trim().split(/\s+/)[0];
				pushRef(first, span, anchor, false);
			}
		} else pushRef(value, span, anchor, true);
	};
	const pushRef = (value: string, span: { start: number; end: number } | null, anchor: boolean, rewritable: boolean) => {
		const v = value.trim();
		if (!v || v.startsWith('#') || /^(?:data|javascript|mailto|tel|blob|about):/i.test(v)) return;
		const abs = resolve(v, pageUrl);
		if (!abs) return;
		const u = new URL(abs);
		const hash = u.hash;
		u.hash = '';
		refs.push({ value: v, url: u.href, hash, start: span?.start ?? -1, end: span?.end ?? -1, anchor, rewritable: rewritable && !!span });
	};

	for (const el of root.querySelectorAll('script,link,img,source,video,audio,track,embed,object,input,iframe,a,style,[style]')) {
		const tag = el.tagName?.toLowerCase();
		if (el.getAttribute('style')) styles.push(el.getAttribute('style')!);
		switch (tag) {
			case 'script':
				if (el.getAttribute('src')) add(el, 'src', false);
				else if (el.text.trim()) scripts.push(el.text);
				break;
			case 'link': {
				const rels = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
				if (rels.some((r) => LINK_RELS_THAT_LOAD.has(r))) add(el, 'href', false);
				break;
			}
			case 'img':
			case 'source':
				add(el, 'src', false);
				add(el, 'srcset', false, true);
				break;
			case 'video':
				add(el, 'src', false);
				add(el, 'poster', false);
				break;
			case 'audio':
			case 'track':
			case 'embed':
			case 'iframe':
			case 'input':
				add(el, 'src', false);
				break;
			case 'object':
				add(el, 'data', false);
				break;
			case 'a':
				add(el, 'href', true);
				break;
			case 'style':
				if (el.text.trim()) styles.push(el.text);
				break;
		}
	}
	return { refs, styles, scripts };
}

/** The character span of attribute `name`'s value inside the opening tag that starts at `from`, or null. */
function attrSpan(source: string, from: number, name: string): { start: number; end: number } | null {
	// The tag ends at the first `>` outside quotes.
	let quote = '';
	let end = from;
	for (; end < source.length; end++) {
		const c = source[end];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") quote = c;
		else if (c === '>') break;
	}
	const tag = source.slice(from, end);
	const m = new RegExp(`\\s${name.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(tag);
	if (!m) return null;
	const raw = m[1] ?? m[2] ?? m[3] ?? '';
	const stop = m.index + m[0].length - (m[3] === undefined ? 1 : 0);
	return { start: from + stop - raw.length, end: from + stop };
}

/**
 * Every address in a stylesheet: each `url(…)`, and each `@import "…"`
 * (`@import url(…)` is a `url(…)`). Comments are ignored; `data:` and
 * `#fragment` values are skipped. Spans are in `css`. Pure.
 */
export function scanCss(css: string, cssUrl: string): Ref[] {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
	const refs: Ref[] = [];
	const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/gid;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		const g = [1, 2, 3, 4, 5].find((i) => m![i] !== undefined)!;
		const value = m[g].trim();
		if (!value || value.startsWith('#') || /^(?:data|blob|about|javascript):/i.test(value)) continue;
		const abs = resolve(value, cssUrl);
		if (!abs) continue;
		const u = new URL(abs);
		const hash = u.hash;
		u.hash = '';
		const [start, end] = m.indices![g]!;
		refs.push({ value, url: u.href, hash, start, end, anchor: false, rewritable: true });
	}
	return refs;
}

const FILE_EXTENSIONS = 'js|mjs|wasm|json|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|mp3|ogg|wav|mp4|webm|pdf';

/**
 * Files a script names that it may load while it runs, which no page lists:
 * a worker started from `${base}/ra-worker.js`, a module fetched with
 * `new URL("x.wasm", import.meta.url)`, a search index that a script tag is
 * made for. It is a guess from the text, so each answer is a candidate to try:
 *
 *  - a quoted or template-quoted file name with a known extension is resolved
 *    against each of `bases` (the script's own folder, the book's root);
 *  - a whole `http(s)` address on `origin` with a known extension is taken as
 *    it is, and one ending in `/` becomes one more base for the names above.
 *
 * Answers absolute addresses, without duplicates, at most `limit`. Never
 * throws; a script that names nothing answers nothing.
 */
export function scanScript(js: string, bases: string[], origin: string, limit = 300): string[] {
	const found = new Set<string>();
	const allBases = [...bases];
	const absolute = /https?:\/\/[^\s"'`\\)<>]+/g;
	for (let m = absolute.exec(js); m && found.size < limit; m = absolute.exec(js)) {
		let u: URL;
		try {
			u = new URL(m[0]);
		} catch {
			continue;
		}
		if (u.origin !== origin) continue;
		if (u.pathname.endsWith('/')) {
			if (allBases.length < bases.length + 5 && !allBases.includes(u.href)) allBases.push(u.href);
		} else if (new RegExp(`\\.(?:${FILE_EXTENSIONS})$`, 'i').test(u.pathname)) {
			u.hash = '';
			found.add(u.href);
		}
	}
	const named = new RegExp(`(?<=["'\`}])((?:\\.{1,2}/|/)?[\\w@%~+.-]+(?:/[\\w@%~+.-]+)*\\.(?:${FILE_EXTENSIONS}))(?=["'\`?#])`, 'gi');
	for (let m = named.exec(js); m && found.size < limit; m = named.exec(js)) {
		const token = m[1];
		if (token.startsWith('.') && !token.startsWith('./') && !token.startsWith('../')) continue;
		// Bundlers leave their own source paths in comments and error strings.
		if (token.includes('node_modules') || token.includes('.pnpm')) continue;
		for (const base of allBases) {
			const rel = token.startsWith('/') ? token.slice(1) : token;
			const abs = resolve(rel, base);
			if (abs && new URL(abs).origin === origin) found.add(abs);
		}
	}
	return [...found].slice(0, limit);
}

/** Replace the given character spans of `text`, which must not overlap. */
export function replaceSpans(text: string, edits: { start: number; end: number; text: string }[]): string {
	let out = text;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	return out;
}

/** An attribute value ready to go back into HTML between double quotes. */
export function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function resolve(href: string, base: string): string | null {
	try {
		return new URL(href.trim(), base).href;
	} catch {
		return null;
	}
}

function squash(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

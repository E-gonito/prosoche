/**
 * Saving a book that is a website (an mdBook such as the Rust book) as a copy
 * on the shelf, chapters and assets, so it reads, searches and remembers the
 * place like any other book.
 *
 * What is saved: the chapters named by the book's table of contents, and
 * everything they need to run from their own files. That is found by reading,
 * never by running:
 *
 *  - what each page points at (scripts, styles, icons, images, media);
 *  - what each stylesheet points at (`url(…)`, `@import`), recursively;
 *  - what each script names that it loads when it runs (a worker started
 *    from `${base}/ra-worker.js`, a search index, a `.wasm`), by reading the
 *    script's text for file names. That is a guess, so each guessed file is
 *    tried and silently dropped if it is not there.
 *
 * Where files go: at their path relative to the book's root folder, under
 * `html/`, so a page's relative links keep working. A file on the same
 * origin but outside the root (`../static/site.css`, `/fonts/x.woff2`) goes
 * under `html/_site/<path from the origin's root>`, and the page or
 * stylesheet that points at it is rewritten to say so, since a relative link
 * cannot climb out of `html/`. Only those pointers are rewritten (and
 * root-relative or absolute same-site ones, which could not work from the
 * frame); a page that needs no rewrite is saved byte for byte. A script that
 * builds such an address at run time cannot be rewritten, and its file, if
 * found, is saved where it would be.
 *
 * What is left alone: addresses on other origins. The frame's CSP blocks
 * them, so whatever they load (a web font from a font host, an analytics
 * script, a remote image) simply does not load in the saved copy. The result
 * names how many there were in its warnings.
 */

import { posix } from 'node:path';
import { config } from '../config';
import type { Shelf } from '../vault/shelf';
import type { ContentsEntry } from '$lib/shared/books';
import { HTML_ROOT } from './manifest';
import { safeFetch, type Lookup, type SafeFetchResult } from './fetch';
import { bookTitle, escapeAttr, pageTitle, readToc, replaceSpans, scanCss, scanHtml, scanScript, tocHtmlFromScript, tocScriptUrl, type Ref, type TocItem } from './site-scan';

export type SiteRefusal = { ok: false; reason: 'bad-url' | 'unreachable' | 'not-a-book' | 'too-large' | 'no-space'; message: string };

export interface SavedSite {
	ok: true;
	title: string;
	chapters: string[];
	contents: ContentsEntry[];
	/**
	 * What `saveSite` adds to what the contract asks for, always set by it and
	 * optional only so a caller's stand-in need not make them up: what was
	 * skipped or could not be reached (one sentence each, empty when nothing
	 * went wrong), how many files were saved (chapters included) and their bytes.
	 */
	warnings?: string[];
	files?: number;
	bytes?: number;
}

/** The folder a site is built in; it takes `html/`'s place only when complete. */
const BUILDING = `${HTML_ROOT}.new`;
/** Where same-origin files outside the book's folder are kept, below `html/`. */
const OUTSIDE = '_site';
const CONCURRENCY = 4;
/** A site with more files than this is not a book. */
const MAX_FILES = 10_000;
const EXCLUDED_PAGES = new Set(['print.html', '404.html', 'toc.html']);
/** Non-HTML files that a page may link to with `<a href>` and a reader would want kept. */
const LINKED_FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|pdf|txt|rs|json|mp3|ogg|mp4|webm)$/i;

/**
 * Save the site at `url` into book `id`'s `html/` folder: every chapter
 * page, and every script, style, font and image they use from the same site.
 * Answers the title, the chapters in reading order (relative to `html/`) and
 * the contents. Replaces an `html/` folder already there only once the new
 * copy is complete, so a failed refresh keeps the old copy.
 *
 * `url` may be the book's folder, its `index.html` or any page in it: the
 * book is that page's folder. Only mdBook sites are understood; others are
 * `not-a-book`. A chapter that answers 404 is skipped with a warning. Any
 * other failure (the network drops, a file is refused) fails the save and
 * removes the half-built copy. `onProgress(done, total)` counts files: `total`
 * grows as pages reveal more files.
 *
 * `fetch` and `lookup` are injectable for tests. Refuses private, loopback
 * and tailnet addresses unless `config.books.allowLocalFetch`; with `fetch`
 * injected and no `lookup`, names are taken to be public. Never throws.
 */
export async function saveSite(
	shelf: Shelf,
	id: string,
	url: string,
	opts: { fetch?: typeof fetch; lookup?: Lookup; onProgress?: (done: number, total: number) => void } = {}
): Promise<SavedSite | SiteRefusal> {
	try {
		await shelf.remove(id, BUILDING);
		const result = await new Saver(shelf, id, opts).run(url);
		if (!result.ok) await shelf.remove(id, BUILDING);
		return result;
	} catch (e) {
		await shelf.remove(id, BUILDING).catch(() => {});
		if (e instanceof Stop) return e.refusal;
		const code = (e as NodeJS.ErrnoException).code;
		if (code === 'ENOSPC') return { ok: false, reason: 'no-space', message: 'The disk filled up while the book was being saved.' };
		return { ok: false, reason: 'unreachable', message: `The book could not be saved: ${(e as Error).message ?? e}` };
	}
}

interface Task {
	url: string;
	path: string;
	/** A chapter page named by the contents; its 404 is a warning, and it counts as a chapter. */
	chapter: boolean;
	/** Guessed from a script's text: not being there is expected, and not worth a word. */
	guess: boolean;
}

class Stop extends Error {
	constructor(readonly refusal: SiteRefusal) {
		super(refusal.message);
	}
}

class Saver {
	private origin = '';
	private rootPath = '/';
	private readonly seen = new Set<string>();
	private readonly saved = new Set<string>();
	private readonly queue: Task[] = [];
	private readonly warnings: string[] = [];
	private readonly crossOrigin = new Set<string>();
	private readonly titles = new Map<string, string>();
	private chapterPaths = new Set<string>();
	private active = 0;
	private waiting: (() => void)[] = [];
	private stopped: Stop | null = null;
	private done = 0;
	private bytes = 0;
	private freeAtStart = 0;
	private skippedChapters: string[] = [];

	private readonly lookup: Lookup | undefined;

	constructor(
		private readonly shelf: Shelf,
		private readonly id: string,
		private readonly opts: { fetch?: typeof fetch; lookup?: Lookup; onProgress?: (done: number, total: number) => void }
	) {
		this.lookup = opts.lookup ?? (opts.fetch ? async () => [{ address: '93.184.216.34', family: 4 }] : undefined);
	}

	async run(startUrl: string): Promise<SavedSite | SiteRefusal> {
		let start: URL;
		try {
			start = new URL(startUrl.trim());
		} catch {
			return { ok: false, reason: 'bad-url', message: `"${startUrl}" is not a web address.` };
		}
		if (start.protocol !== 'http:' && start.protocol !== 'https:') return { ok: false, reason: 'bad-url', message: 'Only http and https addresses can be saved.' };
		if (start.username || start.password) return { ok: false, reason: 'bad-url', message: 'An address with a login in it cannot be saved.' };
		this.freeAtStart = await this.shelf.free();

		// The book's root is the start page's folder; index.html is the first page.
		const last = start.pathname.slice(start.pathname.lastIndexOf('/') + 1);
		const folder = start.pathname.endsWith('/') ? start.pathname : last.includes('.') ? start.pathname.slice(0, start.pathname.lastIndexOf('/') + 1) : `${start.pathname}/`;
		const indexUrl = `${start.origin}${folder}index.html`;

		let first = await this.get(indexUrl);
		if (!first.ok && first.reason === 'status' && first.status === 404) first = await this.get(`${start.origin}${folder}`);
		if (!first.ok) return { ok: false, reason: first.reason === 'bad-url' || first.reason === 'blocked' ? 'bad-url' : 'unreachable', message: first.message };

		// Redirects may have moved the book (http to https, a new host).
		const finalUrl = new URL(first.url);
		this.origin = finalUrl.origin;
		this.rootPath = finalUrl.pathname.slice(0, finalUrl.pathname.lastIndexOf('/') + 1);
		const rootUrl = `${this.origin}${this.rootPath}`;
		const indexHtml = new TextDecoder().decode(first.bytes);

		const toc = await this.findToc(indexHtml, `${rootUrl}index.html`);
		if (!toc) return { ok: false, reason: 'not-a-book', message: 'This does not look like an mdBook site, and only mdBook sites are supported for now. No table of contents was found.' };
		const chapters = this.chaptersOf(toc);
		if (chapters.length === 0) return { ok: false, reason: 'not-a-book', message: 'The table of contents lists no chapters that can be saved, and only mdBook sites are supported for now.' };
		this.chapterPaths = new Set(chapters.map((c) => c.path));

		// The index page is already in hand; every chapter is queued in reading order.
		this.seen.add('index.html');
		this.done = 1;
		for (const c of chapters) this.enqueue({ url: `${rootUrl}${c.path.split('/').map(encodeURIComponent).join('/')}`, path: c.path, chapter: true, guess: false });
		await this.keep('index.html', first.bytes, `${rootUrl}index.html`);

		await this.drain();
		if (this.stopped) return this.stopped.refusal;

		const kept = chapters.filter((c) => this.saved.has(c.path));
		if (this.skippedChapters.length) this.warnings.push(`${this.skippedChapters.length} chapter${this.skippedChapters.length === 1 ? ' was' : 's were'} listed in the contents but not found (404), so left out: ${this.skippedChapters.slice(0, 5).join(', ')}${this.skippedChapters.length > 5 ? ', …' : ''}.`);
		if (this.crossOrigin.size) {
			const hosts = [...new Set([...this.crossOrigin].map((u) => new URL(u).host))];
			this.warnings.push(`${this.crossOrigin.size} resource${this.crossOrigin.size === 1 ? '' : 's'} on other sites (${hosts.slice(0, 4).join(', ')}${hosts.length > 4 ? ', …' : ''}) were left as they are and will not load in the saved copy.`);
		}
		if (kept.length === 0) return { ok: false, reason: 'not-a-book', message: 'None of the chapters in the contents could be fetched.' };

		const chapterList = [...new Set(kept.map((c) => c.path))];
		const contents = this.contentsOf(toc, new Set(chapterList));
		const title = bookTitle(pageTitle(indexHtml), this.titles.get(chapterList[0]) ?? '', new URL(rootUrl).host);

		await this.shelf.move(this.id, BUILDING, HTML_ROOT);
		return { ok: true, title, chapters: chapterList, contents, warnings: this.warnings, files: this.saved.size, bytes: this.bytes };
	}

	// -- the contents ------------------------------------------------------

	/** The table of contents: inline in the page, in its script, or in `toc.html`. */
	private async findToc(indexHtml: string, indexUrl: string): Promise<TocItem[] | null> {
		const inline = readToc(indexHtml, indexUrl);
		if (inline?.some((i) => i.kind === 'chapter')) return inline;

		const scriptUrl = tocScriptUrl(indexHtml, indexUrl);
		if (scriptUrl && this.sameOrigin(scriptUrl)) {
			const js = await this.get(scriptUrl);
			if (js.ok) {
				const html = tocHtmlFromScript(new TextDecoder().decode(js.bytes));
				const items = html ? readToc(html, indexUrl) : null;
				if (items?.some((i) => i.kind === 'chapter')) return items;
			}
		}
		const page = await this.get(new URL('toc.html', indexUrl).href);
		return page.ok ? readToc(new TextDecoder().decode(page.bytes), indexUrl) : null;
	}

	private chaptersOf(items: TocItem[]): { path: string; anchor?: string }[] {
		const out: { path: string; anchor?: string }[] = [];
		const paths = new Set<string>();
		for (const item of items) {
			if (item.kind !== 'chapter') continue;
			const c = this.chapterRef(item.href);
			if (c && !paths.has(c.path)) {
				paths.add(c.path);
				out.push(c);
			}
		}
		return out;
	}

	/** A contents link as a chapter path under the root, or null for an external, non-HTML or excluded page. */
	private chapterRef(href: string): { path: string; anchor?: string } | null {
		const u = new URL(href);
		if (u.origin !== this.origin || !u.pathname.startsWith(this.rootPath) || !/\.html$/i.test(u.pathname)) return null;
		const path = this.savedPath(u.href);
		if (!path || EXCLUDED_PAGES.has(posix.basename(path).toLowerCase())) return null;
		let anchor: string | undefined;
		if (u.hash.length > 1) {
			try {
				anchor = decodeURIComponent(u.hash.slice(1));
			} catch {
				anchor = u.hash.slice(1);
			}
		}
		return { path, anchor };
	}

	private contentsOf(items: TocItem[], kept: Set<string>): ContentsEntry[] {
		const out: ContentsEntry[] = [];
		const keys = new Set<string>();
		let part: string | null = null;
		for (const item of items) {
			if (item.kind === 'part') {
				part = item.title;
				continue;
			}
			const c = this.chapterRef(item.href);
			if (!c || !kept.has(c.path)) continue;
			if (part) {
				out.push({ title: part, place: { kind: 'html', chapter: c.path }, depth: 0 });
				part = null;
			}
			const key = `${c.path}#${c.anchor ?? ''}`;
			if (keys.has(key)) continue;
			keys.add(key);
			out.push({ title: item.title, place: c.anchor ? { kind: 'html', chapter: c.path, anchor: c.anchor } : { kind: 'html', chapter: c.path }, depth: item.depth });
		}
		return out;
	}

	// -- fetching ----------------------------------------------------------

	private get(url: string): Promise<SafeFetchResult> {
		return safeFetch(url, { fetch: this.opts.fetch, lookup: this.lookup });
	}

	private sameOrigin(url: string): boolean {
		try {
			return new URL(url).origin === this.origin;
		} catch {
			return false;
		}
	}

	private enqueue(task: Task): void {
		if (this.seen.has(task.path)) return;
		if (this.seen.size >= MAX_FILES) {
			this.stopped ??= new Stop({ ok: false, reason: 'too-large', message: `This site has more than ${MAX_FILES} files, which is more than a book.` });
			return;
		}
		this.seen.add(task.path);
		this.queue.push(task);
		this.progress();
	}

	private progress(): void {
		this.opts.onProgress?.(this.done, this.seen.size);
	}

	/** Run the queue with a few at a time until it is empty or something stops it. */
	private async drain(): Promise<void> {
		const worker = async () => {
			while (!this.stopped) {
				const task = this.queue.shift();
				if (!task) {
					if (this.active === 0) break;
					await new Promise<void>((r) => this.waiting.push(r));
					continue;
				}
				this.active++;
				try {
					await this.fetchOne(task);
				} catch (e) {
					this.stopped ??= e instanceof Stop ? e : new Stop({ ok: false, reason: 'unreachable', message: `Saving failed: ${(e as Error).message ?? e}` });
				} finally {
					this.active--;
					this.done++;
					this.progress();
					const wake = this.waiting.splice(0);
					for (const w of wake) w();
				}
			}
			for (const w of this.waiting.splice(0)) w();
		};
		await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	}

	private async fetchOne(task: Task): Promise<void> {
		let res = await this.get(task.url);
		// One more try for what a flaky connection or a busy server drops.
		if (!res.ok && (res.reason === 'network' || res.reason === 'timeout' || (res.reason === 'status' && (res.status ?? 0) >= 500))) res = await this.get(task.url);

		if (!res.ok) {
			if (res.reason === 'status' && (res.status === 404 || res.status === 410)) {
				if (task.chapter) this.skippedChapters.push(task.path);
				else if (!task.guess) this.warnings.push(`${task.path} was not found (404) and is missing from the copy.`);
				return;
			}
			if (task.guess) return;
			if (res.reason === 'too-large' || res.reason === 'blocked' || res.reason === 'bad-url') {
				if (task.chapter) throw new Stop({ ok: false, reason: res.reason === 'too-large' ? 'too-large' : 'unreachable', message: res.message });
				this.warnings.push(`${task.path} was skipped: ${res.message}`);
				return;
			}
			throw new Stop({ ok: false, reason: 'unreachable', message: res.message });
		}
		// A server that answers a missing file with its home page is not offering the file.
		if (/^text\/html/i.test(res.contentType) && !/\.html?$/i.test(task.path)) {
			if (!task.guess) this.warnings.push(`${task.path} answered with a web page instead of the file and was skipped.`);
			return;
		}
		await this.keep(task.path, res.bytes, res.url);
	}

	// -- keeping and reading what is kept -----------------------------------

	/** Check the limits, write the file (rewritten if its pointers need it) and queue what it points at. */
	private async keep(path: string, bytes: Uint8Array, url: string): Promise<void> {
		this.bytes += bytes.byteLength;
		if (this.bytes > config.books.maxBytes) throw new Stop({ ok: false, reason: 'too-large', message: `The book is larger than ${Math.round(config.books.maxBytes / 1024 / 1024)} MB.` });
		if (this.freeAtStart - this.bytes < config.books.keepFreeBytes) throw new Stop({ ok: false, reason: 'no-space', message: 'There is not enough free space on the server to save this book.' });

		let out = bytes;
		if (/\.html?$/i.test(path)) out = this.readPage(path, bytes, url);
		else if (/\.css$/i.test(path)) out = this.readStylesheet(path, bytes, url);
		else if (/\.m?js$/i.test(path)) this.readScript(bytes, url);

		await this.shelf.write(this.id, `${BUILDING}/${path}`, out);
		this.saved.add(path);
	}

	private readPage(path: string, bytes: Uint8Array, url: string): Uint8Array {
		const html = new TextDecoder().decode(bytes);
		const scan = scanHtml(html, url);
		const title = pageTitle(html);
		if (title) this.titles.set(path, title);

		const edits = this.followRefs(scan.refs, path);
		for (const css of scan.styles) this.followRefs(scanCss(css, url), path, false);
		for (const js of scan.scripts) this.followScript(js, url);
		return edits.length ? new TextEncoder().encode(replaceSpans(html, edits)) : bytes;
	}

	private readStylesheet(path: string, bytes: Uint8Array, url: string): Uint8Array {
		const css = new TextDecoder().decode(bytes);
		const edits = this.followRefs(scanCss(css, url), path);
		return edits.length ? new TextEncoder().encode(replaceSpans(css, edits)) : bytes;
	}

	private readScript(bytes: Uint8Array, url: string): void {
		this.followScript(new TextDecoder().decode(bytes), url);
	}

	private followScript(js: string, url: string): void {
		const here = new URL('.', url).href;
		const root = `${this.origin}${this.rootPath}`;
		for (const candidate of scanScript(js, here === root ? [here] : [here, root], this.origin)) {
			const path = this.savedPath(candidate);
			if (path && !/\.html?$/i.test(path)) this.enqueue({ url: candidate, path, chapter: false, guess: true });
		}
	}

	/**
	 * Queue what a page or stylesheet points at on this origin, and answer the
	 * edits that make its pointers work from the copy. `rewrite` is false for
	 * inline CSS, whose spans are not in the file's text.
	 */
	private followRefs(refs: Ref[], from: string, rewrite = true): { start: number; end: number; text: string }[] {
		const edits: { start: number; end: number; text: string }[] = [];
		for (const ref of refs) {
			if (!this.sameOrigin(ref.url)) {
				if (!ref.anchor) this.crossOrigin.add(ref.url);
				continue;
			}
			const target = this.savedPath(ref.url);
			if (!target) continue;
			if (ref.anchor) {
				const isChapter = this.chapterPaths.has(target);
				if (!isChapter && !(LINKED_FILE.test(target) && !target.startsWith(`${OUTSIDE}/`))) continue;
				if (!isChapter) this.enqueue({ url: ref.url, path: target, chapter: false, guess: false });
			} else if (!/\.html?$/i.test(target)) {
				this.enqueue({ url: ref.url, path: target, chapter: false, guess: false });
			} else continue;

			if (rewrite && ref.rewritable && needsRewrite(from, ref.value, target)) {
				edits.push({ start: ref.start, end: ref.end, text: escapeAttr(relativeRef(from, target, ref.url, ref.hash)) });
			}
		}
		return edits;
	}

	/**
	 * Where a same-origin address is kept, relative to `html/`: its path below
	 * the book's root, or under `_site/` when it is outside the root. Null for
	 * another origin, a folder address, or a path that would leave the folder.
	 */
	private savedPath(url: string): string | null {
		let u: URL;
		try {
			u = new URL(url);
		} catch {
			return null;
		}
		if (u.origin !== this.origin) return null;
		const inside = u.pathname.startsWith(this.rootPath);
		const rel = inside ? u.pathname.slice(this.rootPath.length) : `${OUTSIDE}${u.pathname}`;
		const parts = rel.split('/').map((p) => {
			try {
				return decodeURIComponent(p);
			} catch {
				return p;
			}
		});
		if (parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) return null;
		return parts.join('/');
	}
}

/**
 * Whether a pointer written as `value` in the file saved at `from` would miss
 * its file `target` once saved: it is absolute or root-relative, or it climbs
 * out of `html/`, or it points across the `_site/` boundary.
 */
function needsRewrite(from: string, value: string, target: string): boolean {
	if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return true;
	const pathOnly = value.split(/[?#]/)[0];
	if (!pathOnly) return false;
	let decoded = pathOnly;
	try {
		decoded = decodeURIComponent(pathOnly);
	} catch {
		// keep as written
	}
	return posix.normalize(posix.join(posix.dirname(from), decoded)) !== target;
}

/** The pointer from the file saved at `from` to the file saved at `target`, keeping the address's query and `#fragment`. */
function relativeRef(from: string, target: string, url: string, hash: string): string {
	const fromDir = posix.dirname(from) === '.' ? [] : posix.dirname(from).split('/');
	const to = target.split('/');
	let i = 0;
	while (i < fromDir.length && i < to.length - 1 && fromDir[i] === to[i]) i++;
	const parts = [...fromDir.slice(i).map(() => '..'), ...to.slice(i).map(encodeURIComponent)];
	return `${parts.join('/')}${new URL(url).search}${hash}`;
}

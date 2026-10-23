/**
 * The code that runs inside a chapter's frame, written as ordinary typed
 * functions so it is checked and tested like the rest of the app, and turned
 * into the injected script by `bridge.ts` with `Function.prototype.toString`.
 *
 * That last step sets the rules for this file:
 *  - every function here must be self-contained: it may call the other
 *    functions in this file by name, but never a module-level constant, an
 *    import, or anything of the server's;
 *  - plain ES2020, no syntax the frame's browser may not know;
 *  - ASCII only, and no `</script`, `<!--` or `]]>` in the source, because the
 *    text is embedded in a page (`bridge.test.ts` checks the output).
 *
 * Messages are the types in `$lib/shared/books` (`FrameMessage` goes up,
 * `ReaderMessage` comes down). They are written out as plain objects here
 * because the frame cannot import.
 */

/** A run of one text node's characters to wrap in a mark: `start` to `end` in its `data`. */
export interface Slice {
	seg: number;
	start: number;
	end: number;
}

/**
 * A stand-in for `localStorage` (and, kept only in memory, `sessionStorage`)
 * in a frame whose opaque origin makes the real ones throw. It behaves as a
 * `Storage` does: values are stored as strings, `getItem` of a missing key is
 * null, `key(n)` out of range is null, and `store.name = 'x'` and
 * `store.name` work as `setItem` and `getItem` do.
 *
 * `onChange` is called after every real change (not for a `setItem` that
 * stores what was already there, and not for seeding). `items()` is a copy of
 * everything held. Never throws.
 */
export function makeStorage(
	initial: Record<string, unknown> | null | undefined,
	onChange: () => void
): { api: any; items: () => Record<string, string> } {
	const map = new Map<string, string>();
	if (initial && typeof initial === 'object') {
		for (const k of Object.keys(initial)) if (typeof initial[k] === 'string') map.set(k, initial[k] as string);
	}
	const methods: Record<string, any> = {
		getItem(k: unknown) {
			const v = map.get(String(k));
			return v === undefined ? null : v;
		},
		setItem(k: unknown, v: unknown) {
			const key = String(k);
			const value = String(v);
			if (map.get(key) === value) return;
			map.set(key, value);
			onChange();
		},
		removeItem(k: unknown) {
			if (map.delete(String(k))) onChange();
		},
		clear() {
			if (map.size === 0) return;
			map.clear();
			onChange();
		},
		key(n: unknown) {
			const keys = Array.from(map.keys());
			const i = Number(n);
			return Number.isInteger(i) && i >= 0 && i < keys.length ? keys[i] : null;
		}
	};
	const api = new Proxy(Object.create(null), {
		get(_target, prop) {
			if (prop === 'length') return map.size;
			if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(methods, prop)) return methods[prop];
			if (prop === Symbol.toStringTag) return 'Storage';
			return typeof prop === 'string' && map.has(prop) ? map.get(prop) : undefined;
		},
		set(_target, prop, value) {
			if (typeof prop === 'string') methods.setItem(prop, value);
			return true;
		},
		deleteProperty(_target, prop) {
			if (typeof prop === 'string') methods.removeItem(prop);
			return true;
		},
		has(_target, prop) {
			return typeof prop === 'string' && (map.has(prop) || prop === 'length' || Object.prototype.hasOwnProperty.call(methods, prop));
		},
		ownKeys() {
			return Array.from(map.keys());
		},
		getOwnPropertyDescriptor(_target, prop) {
			return typeof prop === 'string' && map.has(prop) ? { value: map.get(prop), writable: true, enumerable: true, configurable: true } : undefined;
		}
	});
	return { api, items: () => Object.fromEntries(map) };
}

/**
 * Find `needle` in text that is cut into pieces, as the text of a paragraph
 * is by its `<em>` and `<a>` elements, and say which piece-ranges to mark.
 *
 * Whitespace is not significant: any run of whitespace, in the pieces or the
 * needle, counts as one space, and leading and trailing whitespace of the
 * needle is ignored, so a quote selected across a line break still matches.
 * `fold` ignores case. Matches do not overlap and are returned in order, at
 * most 1000. Each match is its slices, one per piece it touches, in order. An
 * empty needle matches nothing. Pure.
 */
export function matchSegments(segments: string[], needle: string, fold: boolean): Slice[][] {
	const space = /\s/;
	const lower = (c: string): string => {
		if (!fold) return c;
		const l = c.toLowerCase();
		return l.length === 1 ? l : c;
	};
	let text = '';
	const segOf: number[] = [];
	const offOf: number[] = [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		for (let j = 0; j < s.length; j++) {
			const c = s.charAt(j);
			if (space.test(c)) {
				if (text.length > 0 && text.charAt(text.length - 1) !== ' ') {
					text += ' ';
					segOf.push(i);
					offOf.push(j);
				}
			} else {
				text += lower(c);
				segOf.push(i);
				offOf.push(j);
			}
		}
	}
	let want = '';
	for (let j = 0; j < needle.length; j++) {
		const c = needle.charAt(j);
		if (space.test(c)) {
			if (want.length > 0 && want.charAt(want.length - 1) !== ' ') want += ' ';
		} else want += lower(c);
	}
	want = want.replace(/ $/, '');
	const out: Slice[][] = [];
	if (!want) return out;
	let from = 0;
	while (out.length < 1000) {
		const at = text.indexOf(want, from);
		if (at < 0) break;
		const slices: Slice[] = [];
		for (let k = at; k < at + want.length; k++) {
			const last = slices[slices.length - 1];
			if (last && last.seg === segOf[k]) last.end = offOf[k] + 1;
			else slices.push({ seg: segOf[k], start: offOf[k], end: offOf[k] + 1 });
		}
		out.push(slices);
		from = at + want.length;
	}
	return out;
}

/**
 * The bridge itself. `win` and `doc` are the frame's `window` and `document`
 * (passed in so a test can supply fakes). Installs the storage stand-ins
 * before the book's own scripts run, then talks to the reader window by
 * `postMessage`. Does nothing it was not asked to once installed, and never
 * throws into the book's page.
 */
export function frameMain(win: any, doc: any): void {
	const SOURCE = 'prosoche-book';
	const reader = win.parent;
	const talking = !!reader && reader !== win;
	const post = (msg: Record<string, unknown>): void => {
		if (!talking) return;
		msg.source = SOURCE;
		try {
			reader.postMessage(msg, '*');
		} catch (e) {
			/* the reader window is gone */
		}
	};

	// Storage: the real ones throw in an opaque origin, so replace them first.
	let storageTimer: any = 0;
	const flushStorage = (): void => {
		if (!storageTimer) return;
		win.clearTimeout(storageTimer);
		storageTimer = 0;
		post({ type: 'storage', items: local.items() });
	};
	const local = makeStorage(win.__prosocheStorage, () => {
		if (storageTimer) win.clearTimeout(storageTimer);
		storageTimer = win.setTimeout(flushStorage, 500);
	});
	const session = makeStorage(null, () => {});
	for (const [name, api] of [['localStorage', local.api], ['sessionStorage', session.api]] as [string, any][]) {
		try {
			Object.defineProperty(win, name, { value: api, configurable: true });
		} catch (e) {
			/* a browser that will not let it be replaced */
		}
	}
	try {
		void doc.cookie;
	} catch (e) {
		try {
			Object.defineProperty(doc, 'cookie', { get: () => '', set: () => {}, configurable: true });
		} catch (e2) {
			/* leave it */
		}
	}
	win.addEventListener('pagehide', flushStorage);

	// Where this chapter is, relative to the book's html root.
	const chapterPath = (): string => {
		const m = /^\/books\/[^/]+\/c\/(.*)$/.exec(win.location.pathname);
		if (!m) return '';
		try {
			return decodeURIComponent(m[1]);
		} catch (e) {
			return m[1];
		}
	};

	// What the page looks like: the marks always, the reader's page style for EPUBs only.
	const isEpub = !!win.__prosocheBook && win.__prosocheBook.format === 'epub';
	// Mirrors the app's tokens (--panel, --text, --accent, --mark in src/app.css): a frame cannot read them.
	const css =
		'html{--p-paper:#fffdf9;--p-ink:#2a2622;--p-link:#2e6b85;--p-highlight:#fef08a;--p-find:#ffd08a}' +
		'html[data-prosoche-theme=dark]{--p-paper:#23201c;--p-ink:#ebe4d9;--p-link:#6aa8c2;--p-highlight:#5c4d16;--p-find:#7a5a1f}' +
		'mark[data-prosoche]{color:inherit;border-radius:2px}' +
		'mark[data-prosoche=highlight]{background:var(--p-highlight)}' +
		'mark[data-prosoche=find]{background:var(--p-find);outline:1px solid var(--p-link)}' +
		(isEpub
			? 'html[data-prosoche-wait]{visibility:hidden}' +
				'html{background:var(--p-paper)}' +
				'body{max-width:40em!important;margin:0 auto!important;padding:1rem 1.25rem 3rem!important;line-height:1.6!important;' +
				'font-family:"Source Serif 4 Variable","Iowan Old Style",Georgia,serif!important;background:var(--p-paper)!important;color:var(--p-ink)!important;overflow-wrap:break-word}' +
				'body *:not(a):not(mark){color:inherit!important;background-color:transparent!important}' +
				'body a{color:var(--p-link)!important}' +
				'img,svg,video,table{max-width:100%!important}img,video{height:auto!important}' +
				'pre{white-space:pre-wrap;overflow-x:auto}'
			: '');
	const root = doc.documentElement;
	const addStyle = (): void => {
		const style = doc.createElement('style');
		style.setAttribute('data-prosoche-style', '');
		style.textContent = css;
		(doc.head || root).appendChild(style);
	};
	if (isEpub) root.setAttribute('data-prosoche-wait', '');
	addStyle();
	const unwait = (): void => root.removeAttribute('data-prosoche-wait');
	win.setTimeout(unwait, 1500);

	let baseFont = 0;
	const applyStyle = (theme: unknown, scale: unknown): void => {
		const dark = theme === 'dark';
		root.style.colorScheme = dark ? 'dark' : 'light';
		root.setAttribute('data-prosoche-theme', dark ? 'dark' : 'light');
		// Scale from the book's own root size, not from 16px: mdBook sets 62.5%.
		if (!baseFont) {
			root.style.removeProperty('font-size');
			baseFont = parseFloat(win.getComputedStyle(root).fontSize) || 16;
		}
		const n = typeof scale === 'number' && scale > 0.25 && scale < 6 ? scale : 1;
		if (n === 1) root.style.removeProperty('font-size');
		else root.style.setProperty('font-size', baseFont * n + 'px', 'important');
		unwait();
	};

	// Place: the heading (or other element with an id) the reader has scrolled to.
	let lastAnchor: string | null | undefined;
	const nearestAnchor = (): string | undefined => {
		if (!doc.body) return undefined;
		const els = doc.body.querySelectorAll('[id]');
		let head: any = null;
		let headTop = -Infinity;
		let any: any = null;
		let anyTop = -Infinity;
		for (let i = 0; i < els.length; i++) {
			const el = els[i];
			if (!el.id || el.getClientRects().length === 0) continue;
			const top = el.getBoundingClientRect().top;
			if (top > 8) continue;
			if (top > anyTop) {
				any = el;
				anyTop = top;
			}
			if (/^h[1-6]$/.test(String(el.tagName).toLowerCase()) && top > headTop) {
				head = el;
				headTop = top;
			}
		}
		// A heading wins unless something else with an id sits right at the top.
		const pick = any && anyTop >= 0 ? any : head || any;
		return pick ? pick.id : undefined;
	};
	const reportPlace = (): void => {
		const anchor = nearestAnchor();
		if (anchor === lastAnchor) return;
		lastAnchor = anchor;
		const msg: Record<string, unknown> = { type: 'place', chapter: chapterPath() };
		if (anchor) msg.anchor = anchor;
		post(msg);
	};
	let placeTimer: any = 0;
	doc.addEventListener(
		'scroll',
		() => {
			if (placeTimer) return;
			placeTimer = win.setTimeout(() => {
				placeTimer = 0;
				reportPlace();
			}, 400);
		},
		true
	);

	// Selection.
	let selTimer: any = 0;
	let lastQuote: string | null = null;
	doc.addEventListener('selectionchange', () => {
		win.clearTimeout(selTimer);
		selTimer = win.setTimeout(() => {
			const sel = doc.getSelection && doc.getSelection();
			const text = sel ? String(sel).replace(/\s+/g, ' ').trim() : '';
			const quote = text ? text : null;
			if (quote === lastQuote) return;
			lastQuote = quote;
			post({ type: 'selection', quote });
		}, 300);
	});

	// Marks.
	const unmark = (kind: string): void => {
		const marks = doc.querySelectorAll('mark[data-prosoche="' + kind + '"]');
		for (let i = 0; i < marks.length; i++) {
			const m = marks[i];
			const parent = m.parentNode;
			if (!parent) continue;
			while (m.firstChild) parent.insertBefore(m.firstChild, m);
			parent.removeChild(m);
			parent.normalize();
		}
	};
	const BLOCKS = /^(p|div|li|ul|ol|dl|dt|dd|h[1-6]|td|th|tr|table|blockquote|pre|section|article|aside|header|footer|nav|main|figure|figcaption|body|caption|details|summary|form|fieldset)$/;
	const blockOf = (node: any): any => {
		let el = node.parentElement;
		while (el && !BLOCKS.test(String(el.tagName).toLowerCase())) el = el.parentElement;
		return el;
	};
	/** Text nodes in reading order, as runs that share one block element. */
	const textRuns = (): any[][] => {
		const runs: any[][] = [];
		if (!doc.body) return runs;
		const walker = doc.createTreeWalker(doc.body, 4, {
			acceptNode: (n: any) => (n.parentElement && n.parentElement.closest('script,style,noscript,textarea,template,svg,select,option') ? 2 : 1)
		});
		let run: any[] = [];
		let block: any = null;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const b = blockOf(n);
			if (b !== block) {
				if (run.length) runs.push(run);
				run = [];
				block = b;
			}
			run.push(n);
		}
		if (run.length) runs.push(run);
		return runs;
	};
	const wrapSlice = (node: any, start: number, end: number, kind: string): void => {
		if (start >= end) return;
		if (end < node.data.length) node.splitText(end);
		const mid = start > 0 ? node.splitText(start) : node;
		const mark = doc.createElement('mark');
		mark.setAttribute('data-prosoche', kind);
		mid.parentNode.insertBefore(mark, mid);
		mark.appendChild(mid);
	};
	const markAll = (needle: string, fold: boolean, kind: string): void => {
		for (const run of textRuns()) {
			const matches = matchSegments(
				run.map((n: any) => n.data),
				needle,
				fold
			);
			// Last to first, so splitting a node never moves a slice still to come.
			for (let m = matches.length - 1; m >= 0; m--) {
				for (let s = matches[m].length - 1; s >= 0; s--) {
					const slice = matches[m][s];
					wrapSlice(run[slice.seg], slice.start, slice.end, kind);
				}
			}
		}
	};
	const applyMarks = (quotes: unknown, find: unknown): void => {
		unmark('highlight');
		unmark('find');
		if (Array.isArray(quotes)) for (const q of quotes) if (typeof q === 'string') markAll(q, false, 'highlight');
		if (typeof find === 'string' && find.trim()) {
			markAll(find, true, 'find');
			const first = doc.querySelector('mark[data-prosoche="find"]');
			if (first) first.scrollIntoView({ block: 'center', behavior: 'instant' });
			reportPlace();
		}
	};

	const goto = (anchor: unknown): void => {
		let el: any = null;
		if (typeof anchor === 'string' && anchor) el = doc.getElementById(anchor) || doc.getElementsByName(anchor)[0] || null;
		if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' });
		else win.scrollTo(0, 0);
		reportPlace();
	};

	// Links: other hosts open in a new tab; this book's own links stay in the frame.
	const retarget = (a: any): void => {
		let url: any;
		try {
			url = new win.URL(a.getAttribute('href'), doc.baseURI);
		} catch (e) {
			return;
		}
		if (url.protocol === 'javascript:') return;
		if (url.protocol !== win.location.protocol || url.host !== win.location.host) {
			a.setAttribute('target', '_blank');
			a.setAttribute('rel', 'noopener');
		}
	};
	doc.addEventListener(
		'click',
		(ev: any) => {
			const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
			if (a) retarget(a);
		},
		true
	);

	if (talking) {
		win.addEventListener('message', (ev: any) => {
			const d = ev.data;
			if (ev.source !== reader || !d || d.source !== SOURCE) return;
			try {
				if (d.type === 'goto') goto(d.anchor);
				else if (d.type === 'mark') applyMarks(d.quotes, d.find);
				else if (d.type === 'style') applyStyle(d.theme, d.fontScale);
			} catch (e) {
				/* a bad message must not break the book */
			}
		});
	}

	doc.addEventListener('DOMContentLoaded', () => {
		const links = doc.querySelectorAll('a[href]');
		for (let i = 0; i < links.length; i++) retarget(links[i]);
		post({ type: 'ready', chapter: chapterPath(), title: doc.title || '' });
	});
}

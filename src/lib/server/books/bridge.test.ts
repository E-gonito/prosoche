import { describe, it, expect, vi, afterEach } from 'vitest';
import vm from 'node:vm';
import { bridgeScript } from './bridge';
import { makeStorage, matchSegments } from './bridge-frame';

describe('matchSegments', () => {
	const s = (seg: number, start: number, end: number) => ({ seg, start, end });
	const table: [string, string[], string, boolean, ReturnType<typeof s>[][]][] = [
		['one piece', ['hello world'], 'world', false, [[s(0, 6, 11)]]],
		['across two pieces', ['foo ', 'bar'], 'foo bar', false, [[s(0, 0, 4), s(1, 0, 3)]]],
		['across pieces with no space between', ['foo', 'bar'], 'oob', false, [[s(0, 1, 3), s(1, 0, 1)]]],
		['across a whitespace-only piece', ['a', ' ', 'b'], 'a b', false, [[s(0, 0, 1), s(1, 0, 1), s(2, 0, 1)]]],
		['a run of whitespace is one space', ['a  \n b'], 'a b', false, [[s(0, 0, 6)]]],
		['whitespace in the needle is one space', ['a b'], 'a \n\t b', false, [[s(0, 0, 3)]]],
		['no-break space is whitespace', ['a b'], 'a b', false, [[s(0, 0, 3)]]],
		['the needle is trimmed', ['x y z'], '  y ', false, [[s(0, 2, 3)]]],
		['leading whitespace in the text is skipped', [' ', ' ab'], 'ab', false, [[s(1, 1, 3)]]],
		['case matters unless folded', ['Hello HELLO'], 'hello', false, []],
		['folding finds both', ['Hello HELLO'], 'hello', true, [[s(0, 0, 5)], [s(0, 6, 11)]]],
		['folding keeps the offsets where a letter lowercases to two', ['İx Ab'], 'ab', true, [[s(0, 3, 5)]]],
		['matches do not overlap', ['aaaa'], 'aa', false, [[s(0, 0, 2)], [s(0, 2, 4)]]],
		['nothing to find', ['abc'], '   ', false, []],
		['not there', ['abc'], 'abcd', false, []],
		['no pieces', [], 'a', false, []]
	];
	for (const [name, segments, needle, fold, expected] of table) it(name, () => expect(matchSegments(segments, needle, fold)).toEqual(expected));

	it('stops at a thousand matches', () => {
		expect(matchSegments(['a '.repeat(5000)], 'a', false)).toHaveLength(1000);
	});
});

describe('makeStorage', () => {
	const make = (initial?: Record<string, unknown>) => {
		const changes = vi.fn();
		return { ...makeStorage(initial, changes), changes };
	};

	it('stores strings and answers null for a missing key', () => {
		const { api } = make();
		api.setItem('a', 1);
		expect(api.getItem('a')).toBe('1');
		expect(api.getItem('b')).toBeNull();
		expect(api.length).toBe(1);
	});

	it('is seeded without calling onChange, keeping only string values', () => {
		const { api, changes, items } = make({ a: '1', b: 2, c: null });
		expect(items()).toEqual({ a: '1' });
		expect(api.length).toBe(1);
		expect(changes).not.toHaveBeenCalled();
	});

	it('removes, clears, and reports each real change once', () => {
		const { api, changes } = make({ a: '1', b: '2' });
		api.setItem('a', '1');
		expect(changes).not.toHaveBeenCalled();
		api.setItem('a', '9');
		api.removeItem('b');
		api.removeItem('missing');
		api.clear();
		api.clear();
		expect(changes).toHaveBeenCalledTimes(3);
		expect(api.length).toBe(0);
	});

	it('keys in insertion order, null out of range', () => {
		const { api } = make({ x: '1', y: '2' });
		expect([api.key(0), api.key(1), api.key(2), api.key(-1), api.key('z')]).toEqual(['x', 'y', null, null, null]);
	});

	it('answers property access like a Storage does', () => {
		const { api, items, changes } = make({ x: '1' });
		expect(api.x).toBe('1');
		api.y = 5;
		expect(api.getItem('y')).toBe('5');
		expect('y' in api).toBe(true);
		expect(Object.keys(api)).toEqual(['x', 'y']);
		delete api.x;
		expect(items()).toEqual({ y: '5' });
		expect(changes).toHaveBeenCalledTimes(2);
		expect(api.nothing).toBeUndefined();
		expect(Object.prototype.toString.call(api)).toBe('[object Storage]');
	});

	it('does not let a key shadow a method or the length', () => {
		const { api } = make();
		api.setItem('getItem', 'x');
		expect(typeof api.getItem).toBe('function');
		expect(api.getItem('getItem')).toBe('x');
		api.setItem('length', 'x');
		expect(api.length).toBe(2);
	});

	it('items() is a copy', () => {
		const { api, items } = make({ a: '1' });
		const copy = items();
		api.setItem('a', '2');
		expect(copy).toEqual({ a: '1' });
	});
});

describe('bridgeScript', () => {
	const script = bridgeScript();

	it('is plain ASCII that is safe inside a page, and parses', () => {
		expect(script).toMatch(/^[\x20-\x7e\n\t]*$/);
		expect(script).not.toMatch(/<\/script/i);
		expect(script).not.toContain('<!--');
		expect(script).not.toContain(']]>');
		expect(() => new vm.Script(script)).not.toThrow();
	});

	it('has no imports and nothing newer than ES2020', () => {
		expect(script).not.toMatch(/\bimport\b|\bexport\b|\?\?=|\|\|=|&&=|\.at\(|replaceAll/);
	});

	it('is the same text every time', () => expect(bridgeScript()).toBe(script));
});

/** A frame's window and document, just enough for the bridge to run in `vm`. */
function fakeFrame(opts: { cookieThrows?: boolean; storage?: Record<string, string>; format?: string } = {}) {
	const posted: { msg: any; target: string }[] = [];
	const listeners = new Map<string, ((e: any) => void)[]>();
	const on = (type: string, fn: (e: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]);
	const attrs: Record<string, string> = {};
	const style: Record<string, string> = {};
	const parent = { postMessage: (msg: any, target: string) => posted.push({ msg, target }) };
	const doc: any = {
		title: 'Chapter One',
		baseURI: 'http://host/books/abcd/c/x.html',
		documentElement: {
			style: { removeProperty: (k: string) => delete style[k], setProperty: (k: string, v: string) => (style[k] = v), set colorScheme(v: string) { style.colorScheme = v; } },
			setAttribute: (k: string, v: string) => (attrs[k] = v),
			removeAttribute: (k: string) => delete attrs[k]
		},
		head: { appendChild: () => {} },
		createElement: () => ({ setAttribute() {} }),
		addEventListener: on,
		querySelectorAll: () => []
	};
	if (opts.cookieThrows)
		Object.defineProperty(doc, 'cookie', {
			get() {
				throw new Error('SecurityError');
			},
			configurable: true
		});
	const win: any = {
		parent,
		location: { pathname: '/books/abcd/c/OEBPS%2Ftext/ch%201.xhtml', protocol: 'http:', host: 'host' },
		addEventListener: on,
		setTimeout: (...a: any[]) => (setTimeout as any)(...a),
		clearTimeout: (t: any) => clearTimeout(t),
		getComputedStyle: () => ({ fontSize: '16px' }),
		URL,
		scrollTo: () => {},
		__prosocheStorage: opts.storage ?? { seed: 'yes' },
		__prosocheBook: { id: 'abcd', format: opts.format ?? 'site' },
		document: doc
	};
	win.window = win;
	vm.runInNewContext(bridgeScript(), win);
	const fire = (target: string, e: any) => listeners.get(target)?.forEach((fn) => fn(e));
	return { win, doc, parent, posted, fire, attrs, style };
}

describe('the bridge in a fake frame', () => {
	afterEach(() => vi.useRealTimers());

	it('replaces localStorage before anything else, seeded from the page', () => {
		const { win } = fakeFrame();
		expect(win.localStorage.getItem('seed')).toBe('yes');
		expect(win.sessionStorage.getItem('seed')).toBeNull();
	});

	it('posts the whole of localStorage once, half a second after the last change', () => {
		vi.useFakeTimers();
		const { win, posted } = fakeFrame();
		win.localStorage.setItem('a', '1');
		vi.advanceTimersByTime(300);
		win.localStorage.setItem('b', '2');
		vi.advanceTimersByTime(499);
		expect(posted).toHaveLength(0);
		vi.advanceTimersByTime(2);
		expect(posted).toEqual([{ msg: { source: 'prosoche-book', type: 'storage', items: { seed: 'yes', a: '1', b: '2' } }, target: '*' }]);
	});

	it('never posts sessionStorage, and posts nothing for a change that changes nothing', () => {
		vi.useFakeTimers();
		const { win, posted } = fakeFrame();
		win.sessionStorage.setItem('a', '1');
		win.localStorage.setItem('seed', 'yes');
		vi.advanceTimersByTime(2000);
		expect(posted).toHaveLength(0);
	});

	it('flushes a pending change when the page is hidden', () => {
		vi.useFakeTimers();
		const { win, posted, fire } = fakeFrame();
		win.localStorage.setItem('a', '1');
		fire('pagehide', {});
		expect(posted).toHaveLength(1);
		vi.advanceTimersByTime(2000);
		expect(posted).toHaveLength(1);
	});

	it('reports ready with the decoded chapter path and the title', () => {
		const { posted, fire } = fakeFrame();
		fire('DOMContentLoaded', {});
		expect(posted[0]).toEqual({ msg: { source: 'prosoche-book', type: 'ready', chapter: 'OEBPS/text/ch 1.xhtml', title: 'Chapter One' }, target: '*' });
	});

	it('makes document.cookie harmless when reading it throws', () => {
		const { doc } = fakeFrame({ cookieThrows: true });
		expect(doc.cookie).toBe('');
		expect(() => (doc.cookie = 'a=b')).not.toThrow();
	});

	it('obeys a style message from its parent and ignores anyone else', () => {
		const { parent, fire, attrs } = fakeFrame();
		fire('message', { source: {}, data: { source: 'prosoche-book', type: 'style', theme: 'dark', fontScale: 1 } });
		fire('message', { source: parent, data: { type: 'style', theme: 'dark', fontScale: 1 } });
		expect(attrs['data-prosoche-theme']).toBeUndefined();
		fire('message', { source: parent, data: { source: 'prosoche-book', type: 'style', theme: 'dark', fontScale: 1.5 } });
		expect(attrs['data-prosoche-theme']).toBe('dark');
	});

	it('scales the root font size from the book\'s own, and puts it back at 1', () => {
		const { parent, fire, style } = fakeFrame();
		const send = (fontScale: number) => fire('message', { source: parent, data: { source: 'prosoche-book', type: 'style', theme: 'light', fontScale } });
		send(1.5);
		expect(style['font-size']).toBe('24px');
		send(1);
		expect(style['font-size']).toBeUndefined();
	});

	it('says nothing and listens to nothing when the page is not in a frame', () => {
		const posted: unknown[] = [];
		const listeners: string[] = [];
		const win: any = { addEventListener: (t: string) => listeners.push(t), setTimeout, clearTimeout, getComputedStyle: () => ({}), location: { pathname: '/' } };
		win.parent = win;
		win.postMessage = (m: unknown) => posted.push(m);
		win.window = win;
		win.document = { documentElement: { setAttribute() {}, removeAttribute() {}, style: {} }, createElement: () => ({ setAttribute() {} }), head: { appendChild() {} }, querySelectorAll: () => [], addEventListener: (t: string, f: () => void) => t === 'DOMContentLoaded' && late.push(f) };
		const late: (() => void)[] = [];
		vm.runInNewContext(bridgeScript(), win);
		late.forEach((f) => f());
		expect(posted).toEqual([]);
		expect(listeners).not.toContain('message');
	});
});

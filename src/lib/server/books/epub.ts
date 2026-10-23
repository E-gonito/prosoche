/**
 * Unpacking an EPUB into HTML chapters, so it reads in the same reader as a
 * saved site.
 *
 * An EPUB is a zip. `META-INF/container.xml` names the package document (the
 * OPF); the OPF holds the title, a manifest of every file, and the spine, the
 * reading order. The table of contents is a separate file the OPF points at:
 * the EPUB 3 navigation document, or for EPUB 2 the NCX. This module reads
 * all of that and nothing else about the book's content; the chapters are
 * left exactly as they are and are served by `chapter.ts`.
 */

import { posix } from 'node:path';
import { unzipSync, type Unzipped } from 'fflate';
import { parse, type HTMLElement } from 'node-html-parser';
import { ShelfPathError, type Shelf } from '../vault/shelf';
import type { ContentsEntry } from '$lib/shared/books';
import { config } from '../config';
import { HTML_ROOT, ORIGINAL } from './manifest';

type Unpacked = { ok: true; title: string | null; chapters: string[]; contents: ContentsEntry[] };
type Refused = { ok: false; reason: 'bad-epub'; message: string };

/** Where the new copy is built, so `html/` is replaced only by a complete one. */
const STAGING = `${HTML_ROOT}.new`;

/**
 * Unpack the book's `original.epub` into its `html/` folder, every file at
 * its path in the zip, and read its title, its spine (`chapters`, in reading
 * order, relative to `html/`) and its table of contents (EPUB 3 nav, or the
 * EPUB 2 NCX). Replaces an `html/` folder already there. Refuses `bad-epub`
 * for a file that is not a readable EPUB, or one with an entry that would
 * unpack outside the folder; nothing is left in `html/` then, and an `html/`
 * already there is kept as it was. Never throws.
 *
 * Every spine item is a chapter, including `linear="no"` ones: they are
 * usually a cover, notes or answers, and dropping them would lose text the
 * search and the contents can point at. The contents fall back to one entry
 * per chapter, titled by the chapter's own `<title>`, when the book has none.
 */
export async function unpackEpub(shelf: Shelf, id: string): Promise<Unpacked | Refused> {
	const refuse = (message: string): Refused => ({ ok: false, reason: 'bad-epub', message });
	try {
		const zipped = await shelf.read(id, ORIGINAL.epub);
		if (!zipped) return refuse('The EPUB file is missing from the shelf.');

		let entries: Unzipped;
		try {
			entries = readZip(zipped);
		} catch (e) {
			return refuse(e instanceof TooBig ? e.message : 'That file is not a readable EPUB: the zip is damaged.');
		}

		const names = new Map<string, Uint8Array>();
		for (const [raw, bytes] of Object.entries(entries)) {
			if (raw.endsWith('/')) continue;
			const name = safeName(raw);
			if (name === null) return refuse(`That EPUB has an entry that would unpack outside the book's folder (${JSON.stringify(raw.slice(0, 80))}), so it was refused.`);
			names.set(name, bytes);
		}

		const book = readPackage(names);
		if (typeof book === 'string') return refuse(book);

		await shelf.remove(id, STAGING);
		try {
			for (const [name, bytes] of names) await shelf.write(id, `${STAGING}/${name}`, bytes);
			await shelf.move(id, STAGING, HTML_ROOT);
		} catch (e) {
			await shelf.remove(id, STAGING);
			if (e instanceof ShelfPathError) return refuse('That EPUB has an entry that would unpack outside the book\'s folder, so it was refused.');
			return refuse('That EPUB could not be unpacked: two of its entries clash.');
		}
		return { ok: true, ...book };
	} catch {
		return refuse('That file could not be read as an EPUB.');
	}
}

class TooBig extends Error {}

/** Unzip in memory, refusing a zip that claims to hold more than a book may be (a zip bomb). */
function readZip(zipped: Uint8Array): Unzipped {
	let total = 0;
	return unzipSync(zipped, {
		filter: (file) => {
			total += file.originalSize;
			if (total > config.books.maxBytes) throw new TooBig('That EPUB unpacks to more than the largest book allowed.');
			return true;
		}
	});
}

/**
 * A zip entry's name as a path inside `html/`, or null for one that would
 * leave it: absolute, with a `..` segment, or holding a NUL. The shelf checks
 * the same, but only against the book's whole folder, where `../book.json`
 * is still inside; here `html/` is the boundary.
 */
function safeName(raw: string): string | null {
	const name = raw.replace(/\\/g, '/');
	if (!name || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
	const parts = name.split('/').filter((p) => p !== '' && p !== '.');
	if (parts.length === 0 || parts.includes('..')) return null;
	return parts.join('/');
}

/** The title, chapters and contents from the zip's entries, or a sentence saying why not. */
function readPackage(files: Map<string, Uint8Array>): Omit<Unpacked, 'ok'> | string {
	const text = (name: string): string | null => {
		const bytes = files.get(name);
		return bytes ? new TextDecoder().decode(bytes) : null;
	};

	const container = text('META-INF/container.xml');
	if (container === null) return 'That is not an EPUB: it has no META-INF/container.xml.';
	const rootfile = elements(parse(container), 'rootfile')[0]?.getAttribute('full-path');
	if (!rootfile) return 'That EPUB\'s container.xml does not name a package document.';
	const opfPath = decodePath(rootfile);
	const opfText = text(opfPath);
	if (opfText === null) return `That EPUB's package document (${opfPath}) is missing.`;

	const opf = parse(opfText);
	const dir = posix.dirname(opfPath);
	const resolve = (href: string, from = dir): { path: string; anchor?: string } | null => {
		const [file, ...rest] = href.split('#');
		const joined = file ? posix.normalize(posix.join(from, decodePath(file))) : null;
		const path = joined === null ? null : safeName(joined);
		if (path === null) return null;
		const anchor = rest.join('#');
		return anchor ? { path, anchor: decodePath(anchor) } : { path };
	};

	const items = new Map<string, { href: string; type: string; properties: string[] }>();
	for (const item of elements(opf, 'item')) {
		const itemId = item.getAttribute('id');
		const href = item.getAttribute('href');
		if (itemId && href) items.set(itemId, { href, type: item.getAttribute('media-type') ?? '', properties: (item.getAttribute('properties') ?? '').split(/\s+/) });
	}

	const chapters: string[] = [];
	for (const ref of elements(opf, 'itemref')) {
		const item = items.get(ref.getAttribute('idref') ?? '');
		const target = item && resolve(item.href);
		if (target && files.has(target.path) && !chapters.includes(target.path)) chapters.push(target.path);
	}
	if (chapters.length === 0) return 'That EPUB has no readable chapters: its spine is empty.';

	const title = clean(elements(opf, 'title')[0]?.text ?? '') || null;

	let contents: ContentsEntry[] = [];
	const nav = [...items.values()].find((i) => i.properties.includes('nav'));
	const navTarget = nav && resolve(nav.href);
	const navText = navTarget && text(navTarget.path);
	if (navTarget && navText) contents = readNav(parse(navText), (href) => resolve(href, posix.dirname(navTarget.path)));

	if (contents.length === 0) {
		const spineToc = elements(opf, 'spine')[0]?.getAttribute('toc');
		const ncx = items.get(spineToc ?? '') ?? [...items.values()].find((i) => i.type === 'application/x-dtbncx+xml');
		const ncxTarget = ncx && resolve(ncx.href);
		const ncxText = ncxTarget && text(ncxTarget.path);
		if (ncxTarget && ncxText) contents = readNcx(parse(ncxText), (href) => resolve(href, posix.dirname(ncxTarget.path)));
	}

	contents = contents.filter((c) => c.place.kind === 'html' && files.has(c.place.chapter));
	if (contents.length === 0) {
		contents = chapters.map((chapter) => ({
			title: clean(elements(parse(text(chapter) ?? ''), 'title')[0]?.text ?? '') || posix.basename(chapter).replace(/\.[^.]+$/, ''),
			place: { kind: 'html', chapter },
			depth: 0
		}));
	}
	return { title, chapters, contents };
}

type Resolver = (href: string) => { path: string; anchor?: string } | null;

/** The EPUB 3 navigation document's `<nav epub:type="toc">`, nested `ol`s as depth. */
function readNav(doc: HTMLElement, resolve: Resolver): ContentsEntry[] {
	const navs = elements(doc, 'nav');
	const toc = navs.find((n) => (n.getAttribute('epub:type') ?? n.getAttribute('type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
	if (!toc) return [];
	const out: ContentsEntry[] = [];
	const walkList = (ol: HTMLElement, depth: number): void => {
		for (const li of ol.childNodes.filter(isElement).filter((e) => local(e) === 'li')) {
			const kids = li.childNodes.filter(isElement);
			const label = kids.find((e) => local(e) === 'a') ?? kids.find((e) => local(e) === 'span');
			const nested = kids.filter((e) => local(e) === 'ol');
			const at = out.length;
			const href = label && local(label) === 'a' ? label.getAttribute('href') : null;
			const target = href ? resolve(href) : null;
			if (label && target) out.push({ title: clean(label.text), place: placeOf(target), depth });
			for (const sub of nested) walkList(sub, label ? depth + 1 : depth);
			// A heading with no link of its own opens at its first child.
			if (label && !target && out.length > at) out.splice(at, 0, { title: clean(label.text), place: out[at].place, depth });
		}
	};
	for (const ol of toc.childNodes.filter(isElement).filter((e) => local(e) === 'ol')) walkList(ol, 0);
	return out.filter((e) => e.title);
}

/** The EPUB 2 NCX's `navMap`, nested `navPoint`s as depth. */
function readNcx(doc: HTMLElement, resolve: Resolver): ContentsEntry[] {
	const map = elements(doc, 'navmap')[0];
	if (!map) return [];
	const out: ContentsEntry[] = [];
	const walk = (parent: HTMLElement, depth: number): void => {
		for (const point of parent.childNodes.filter(isElement).filter((e) => local(e) === 'navpoint')) {
			const kids = point.childNodes.filter(isElement);
			const label = kids.find((e) => local(e) === 'navlabel');
			const src = kids.find((e) => local(e) === 'content')?.getAttribute('src');
			const target = src ? resolve(src) : null;
			const title = clean(label?.text ?? '');
			if (target && title) out.push({ title, place: placeOf(target), depth });
			walk(point, target && title ? depth + 1 : depth);
		}
	};
	walk(map, 0);
	return out;
}

const placeOf = (t: { path: string; anchor?: string }): ContentsEntry['place'] => (t.anchor ? { kind: 'html', chapter: t.path, anchor: t.anchor } : { kind: 'html', chapter: t.path });

/** The local name of a tag, lower-cased, without any namespace prefix: `dc:title` is `title`. */
const local = (e: HTMLElement): string => e.rawTagName.toLowerCase().replace(/^.*:/, '');

const isElement = (n: { nodeType: number }): n is HTMLElement => n.nodeType === 1;

/** Every element under `root` with this local name, in document order. */
const elements = (root: HTMLElement, name: string): HTMLElement[] => root.querySelectorAll('*').filter((e) => local(e) === name);

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A path from an XML attribute, percent-decoded; left as it was when the escapes are malformed. */
function decodePath(p: string): string {
	try {
		return decodeURIComponent(p);
	} catch {
		return p;
	}
}

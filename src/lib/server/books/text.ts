/**
 * Pulling a book's text out for search: one entry per PDF page, or per
 * section of an HTML chapter (the text between one heading with an id and
 * the next). Kept as `text.json` on the shelf, so the index can be filled
 * again on every start without extracting again.
 *
 * A PDF page that has no text at all is left out rather than written as an
 * empty entry; search cannot find anything on it either way. A PDF where
 * almost no page has text is a scan, and is `none`.
 */

import { parse, type HTMLElement, type Node } from 'node-html-parser';
import type { Shelf } from '../vault/shelf';
import type { BookManifest, Place, TextState } from '$lib/shared/books';
import { HTML_ROOT, ORIGINAL, TEXT } from './manifest';
import { openPdfText } from './pdf';

/** One searchable piece of a book. */
export interface TextEntry {
	place: Place;
	/** `p. 412`, or the section's heading. */
	label: string;
	text: string;
}

/** Fewer than this share of a PDF's pages with any text and it counts as a scan. */
const SCAN_SHARE = 0.01;

/** Let the event loop run: other requests, timers, the progress write. */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Pull the text out of a book on the shelf and write `text.json`. Reports
 * progress as it goes (`done` of `total` pages or chapters), yielding to the
 * event loop between pages so the server keeps answering. Answers the final
 * state: `done`, `none` for a PDF with no text layer, or `failed`. Never
 * throws. Does not touch the manifest; the caller records the state.
 */
export async function pullText(shelf: Shelf, manifest: BookManifest, onProgress?: (done: number, total: number) => void): Promise<TextState> {
	try {
		const entries = manifest.format === 'pdf' ? await pdfEntries(shelf, manifest, onProgress) : await htmlEntries(shelf, manifest, onProgress);
		if (typeof entries === 'string') return { state: 'failed', message: entries };
		if (manifest.format === 'pdf' && entries.length < Math.max(1, (manifest.pages ?? entries.length) * SCAN_SHARE)) return { state: 'none' };
		await shelf.write(manifest.id, TEXT, JSON.stringify(entries));
		return { state: 'done', parts: entries.length };
	} catch (e) {
		return { state: 'failed', message: e instanceof Error ? e.message : String(e) };
	}
}

/** A book's `text.json`, or null when it has none yet or it is unreadable. Never throws. */
export async function readText(shelf: Shelf, id: string): Promise<TextEntry[] | null> {
	try {
		const raw = await shelf.readText(id, TEXT);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter(
			(e): e is TextEntry => !!e && typeof e.label === 'string' && typeof e.text === 'string' && !!e.place && (e.place.kind === 'page' || e.place.kind === 'html')
		);
	} catch {
		return null;
	}
}

/** One entry per page that has text, or the reason the PDF could not be read. */
async function pdfEntries(shelf: Shelf, manifest: BookManifest, onProgress?: (done: number, total: number) => void): Promise<TextEntry[] | string> {
	const bytes = await shelf.read(manifest.id, ORIGINAL.pdf);
	if (!bytes) return 'The PDF is not on the shelf.';
	const pdf = await openPdfText(bytes);
	if (!pdf) return 'The PDF could not be opened.';
	const entries: TextEntry[] = [];
	try {
		for (let n = 1; n <= pdf.pages; n++) {
			const text = tidyPdfText(await pdf.page(n));
			if (text) entries.push({ place: { kind: 'page', page: n }, label: `p. ${n}`, text });
			onProgress?.(n, pdf.pages);
			await yieldToLoop();
		}
	} finally {
		await pdf.close();
	}
	return entries;
}

/** Runs of spaces become one; each line trimmed; empty lines dropped. Pure. */
function tidyPdfText(raw: string): string {
	return raw
		.split('\n')
		.map((line) => line.replace(/[ \t ]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

/** One entry per section of every chapter, in reading order. A chapter that is missing is skipped. */
async function htmlEntries(shelf: Shelf, manifest: BookManifest, onProgress?: (done: number, total: number) => void): Promise<TextEntry[]> {
	const chapters = manifest.chapters ?? [];
	const entries: TextEntry[] = [];
	for (let i = 0; i < chapters.length; i++) {
		const html = await shelf.readText(manifest.id, `${HTML_ROOT}/${chapters[i]}`);
		if (html) entries.push(...sections(html, chapters[i]));
		onProgress?.(i + 1, chapters.length);
		await yieldToLoop();
	}
	return entries;
}

/** Elements whose text is not the book's: scripts, styles, navigation, and mdBook's sidebar and menus. */
const CHROME = [
	'script',
	'style',
	'nav',
	'noscript',
	'template',
	'#sidebar',
	'#menu-bar',
	'.nav-chapters',
	'.nav-wrapper',
	'#search-wrapper',
	'mdbook-sidebar-scrollbox'
].join(',');

/** Elements that do not break a line of text, so no space is put around them. */
const INLINE = new Set(['a', 'span', 'em', 'strong', 'b', 'i', 'u', 's', 'code', 'kbd', 'var', 'samp', 'sup', 'sub', 'small', 'mark', 'abbr', 'cite', 'q', 'wbr']);

const HEADING = /^h[1-4]$/;

/**
 * Split one HTML chapter into sections for search. A section runs from a
 * heading `h1` to `h4` that has an `id` to the next such heading; the text
 * before the first is a section of its own, with no anchor, labelled with the
 * chapter's `<title>` (or its path). Navigation, scripts and styles are
 * dropped, whitespace is collapsed, and a section with no text is left out.
 * `chapter` is the path relative to the book's HTML root. Pure; never throws
 * for malformed HTML.
 */
export function sections(html: string, chapter: string): TextEntry[] {
	const root = parse(html.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>/, '').replace(/^\s*<!doctype[^>]*>/i, ''), {
		// Not `pre`: its markup must be parsed, or `<code>` tags come out as text.
		blockTextElements: { script: false, noscript: false, style: false }
	});
	const title = collapse(root.querySelector('title')?.text ?? '') || chapter;
	for (const el of root.querySelectorAll(CHROME)) el.remove();

	const out: TextEntry[] = [];
	let current = { anchor: undefined as string | undefined, label: title, parts: [] as string[] };
	const flush = () => {
		const text = collapse(current.parts.join(''));
		if (text) {
			const place: Place = current.anchor ? { kind: 'html', chapter, anchor: current.anchor } : { kind: 'html', chapter };
			out.push({ place, label: current.label, text });
		}
	};

	const walk = (node: Node): void => {
		if (node.nodeType === 3) {
			current.parts.push(node.text);
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as HTMLElement;
		const tag = el.rawTagName?.toLowerCase() ?? '';
		if (tag === 'head' || tag === 'title') return;
		const id = el.getAttribute('id');
		if (HEADING.test(tag) && id) {
			flush();
			const label = collapse(el.text);
			current = { anchor: id, label: label || id, parts: [label] };
			return;
		}
		const block = !INLINE.has(tag);
		if (block) current.parts.push(' ');
		for (const child of el.childNodes) walk(child);
		if (block) current.parts.push(' ');
	};
	walk(root);
	flush();
	return out;
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

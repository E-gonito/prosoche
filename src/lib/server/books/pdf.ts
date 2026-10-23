/**
 * Everything the server asks pdf.js: a PDF's title, page count and outline
 * for the manifest (`readPdf`), and its text page by page for search
 * (`openPdfText`). pdf.js is used nowhere else on the server, so its quirks
 * are written down once, here.
 *
 * pdf.js is loaded on first use, not at start: it is a megabyte of script a
 * server that never sees a PDF should not parse. Its legacy build is the one
 * written for Node. Fonts are never loaded as browser fonts, nothing is
 * evaluated (`isEvalSupported: false`), and it is quiet (`verbosity: 0`), so
 * a damaged page costs a hole in the text and not a flood of log lines.
 *
 * pdf.js takes ownership of the bytes it is given and detaches the buffer
 * (the caller's array reads as empty afterwards). `readPdf` copies, so its
 * callers keep their bytes; `openPdfText` does not, because its one caller
 * has just read the file and wants the memory back.
 */

import type { ContentsEntry } from '$lib/shared/books';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type Document = Awaited<ReturnType<Pdfjs['getDocument']>['promise']>;

let loaded: Promise<Pdfjs> | undefined;
const pdfjs = (): Promise<Pdfjs> => (loaded ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

/** An outline longer than this is cut: the manifest should stay small, and no book has more chapters and sections. */
const MAX_OUTLINE = 5000;

/** Longest title kept. */
const MAX_TITLE = 200;

async function open(bytes: Uint8Array): Promise<{ doc: Document; close: () => Promise<void> }> {
	const lib = await pdfjs();
	// `isEvalSupported` is read by pdf.js but missing from its published types.
	const options: Parameters<Pdfjs['getDocument']>[0] & { isEvalSupported: boolean } = {
		data: bytes,
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: 0
	};
	const task = lib.getDocument(options);
	const doc = await task.promise;
	return { doc, close: () => task.destroy() };
}

/**
 * A title worth showing from what a PDF's info dictionary says, or null.
 * Word, Acrobat and the like fill the title with the tool's name and the
 * file they exported: `Microsoft Word - notes.doc`. The tool's prefix is
 * dropped, and what is left counts only if it is not itself a file name or a
 * placeholder (`Untitled`, `notes.doc`, `slides.pptx`). Whitespace is
 * collapsed and the title cut to 200 characters. Pure; never throws.
 */
export function cleanTitle(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let title = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
	title = title.replace(/^(?:microsoft\s+(?:word|powerpoint|excel)|adobe\s+acrobat|acrobat\s+distiller)\s+-\s+/i, '').trim();
	if (!title) return null;
	if (/^(?:untitled|unnamed|title|document|no title)\d*$/i.test(title)) return null;
	if (/^\S+\.(?:docx?|pptx?|xlsx?|pdf|tex|dvi|ps|indd|odt|rtf|txt|qxd|pmd|fm)$/i.test(title)) return null;
	return title.length > MAX_TITLE ? title.slice(0, MAX_TITLE).trimEnd() : title;
}

/**
 * Read a PDF's metadata from its bytes. `title` is the document's own title
 * when it has a sensible one (see `cleanTitle`), else null (the caller falls
 * back to the file name). `contents` is the outline flattened in order, each
 * entry a page place with the depth it was nested at; empty when the PDF has
 * no outline, and an outline entry whose destination cannot be resolved to a
 * page is left out. Refuses `bad-pdf` for bytes pdf.js cannot open,
 * including an encrypted PDF it has no password for. The caller's bytes are
 * left intact. Never throws.
 */
export async function readPdf(
	bytes: Uint8Array
): Promise<{ ok: true; title: string | null; pages: number; contents: ContentsEntry[] } | { ok: false; reason: 'bad-pdf'; message: string }> {
	let opened: Awaited<ReturnType<typeof open>> | undefined;
	try {
		opened = await open(bytes.slice());
		const { doc } = opened;
		if (!(doc.numPages >= 1)) return { ok: false, reason: 'bad-pdf', message: 'The PDF has no pages.' };
		const meta = await doc.getMetadata().catch(() => null);
		const info = (meta?.info ?? {}) as Record<string, unknown>;
		const contents = await outline(doc).catch(() => []);
		return { ok: true, title: cleanTitle(info.Title), pages: doc.numPages, contents };
	} catch (e) {
		return { ok: false, reason: 'bad-pdf', message: e instanceof Error ? e.message : String(e) };
	} finally {
		await opened?.close().catch(() => undefined);
	}
}

/** The outline as a flat list, depth-first, each entry resolved to a page. */
async function outline(doc: Document): Promise<ContentsEntry[]> {
	const tree = await doc.getOutline();
	const out: ContentsEntry[] = [];
	// Many entries point at the same few pages; resolving a reference once is enough.
	const pageOf = new Map<string, number | null>();

	const resolve = async (dest: unknown): Promise<number | null> => {
		try {
			const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
			if (!Array.isArray(target) || target.length === 0) return null;
			const first = target[0];
			if (typeof first === 'number') return Number.isInteger(first) && first >= 0 && first < doc.numPages ? first + 1 : null;
			if (first && typeof first === 'object' && 'num' in first) {
				const key = `${(first as { num: number }).num}/${(first as { gen: number }).gen}`;
				if (!pageOf.has(key)) pageOf.set(key, (await doc.getPageIndex(first as never)) + 1);
				return pageOf.get(key) ?? null;
			}
			return null;
		} catch {
			return null;
		}
	};

	const walk = async (items: NonNullable<typeof tree>, depth: number): Promise<void> => {
		for (const item of items) {
			if (out.length >= MAX_OUTLINE) return;
			const title = cleanOutlineTitle(item.title);
			const page = title ? await resolve(item.dest) : null;
			if (title && page) out.push({ title, place: { kind: 'page', page }, depth });
			if (item.items?.length) await walk(item.items as NonNullable<typeof tree>, depth + 1);
		}
	};
	if (tree) await walk(tree, 0);
	return out;
}

function cleanOutlineTitle(raw: unknown): string {
	return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
}

/** A PDF opened for reading its text page by page. */
export interface PdfText {
	pages: number;
	/**
	 * Page `n`'s text (1-based): items joined with spaces, a newline where
	 * pdf.js says a line ended, whitespace not otherwise tidied. '' for a page
	 * with no text or one pdf.js cannot read; never throws.
	 */
	page(n: number): Promise<string>;
	/** Release pdf.js's hold on the file. Call once, when done. */
	close(): Promise<void>;
}

/**
 * Open a PDF to read its text. Takes the bytes over: do not use the array
 * afterwards. Null for bytes pdf.js cannot open. Never throws.
 */
export async function openPdfText(bytes: Uint8Array): Promise<PdfText | null> {
	try {
		const { doc, close } = await open(bytes);
		return {
			pages: doc.numPages,
			async page(n) {
				try {
					const page = await doc.getPage(n);
					try {
						const content = await page.getTextContent();
						let text = '';
						for (const item of content.items) {
							if (!('str' in item)) continue;
							text += item.str;
							text += item.hasEOL ? '\n' : ' ';
						}
						return text;
					} finally {
						page.cleanup();
					}
				} catch {
					return '';
				}
			},
			close: () => close().catch(() => undefined)
		};
	} catch {
		return null;
	}
}

/**
 * A PDF generator with no dependencies, for tests that need a real PDF:
 * unit tests of `server/books/pdf.ts` and `text.ts`, and the e2e specs.
 *
 * Writes the plainest valid PDF 1.4: one Helvetica font, one uncompressed
 * content stream per page, an optional info dictionary and outline, and a
 * cross-reference table with true byte offsets, so pdf.js opens it without
 * repairing anything. Not a general writer: no images, no compression, no
 * encryption, text only in Latin-1.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const FONT_SIZE = 10;
const LEADING = 12;
/** Characters that fit across a line at 10 pt Helvetica between the margins, on average. */
const LINE_CHARS = 100;

/**
 * Escape text for a PDF literal string; anything past Latin-1 becomes `?`.
 * @param {string} text
 */
function literal(text) {
	let out = '';
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 63;
		if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
		else if (code < 32 || code > 255) out += code === 10 || code === 13 || code === 9 ? ' ' : '?';
		else out += ch;
	}
	return `(${out})`;
}

/**
 * A text string as UTF-16BE hex, so a title may hold any character.
 * @param {string} text
 */
function unicodeString(text) {
	let hex = 'FEFF';
	for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0');
	return `<${hex}>`;
}

/**
 * Break text into lines of at most `LINE_CHARS`, at spaces; blank lines in the text stay.
 * @param {string} text
 */
function wrap(text) {
	/** @type {string[]} */
	const lines = [];
	for (const paragraph of text.split(/\r?\n/)) {
		let line = '';
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			if (line && line.length + 1 + word.length > LINE_CHARS) {
				lines.push(line);
				line = word;
			} else line = line ? `${line} ${word}` : word;
		}
		lines.push(line);
	}
	return lines;
}

/**
 * One page's content stream: its lines top to bottom, each its own text-positioning step.
 * @param {string} text
 */
function pageStream(text) {
	const lines = wrap(text).slice(0, Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING));
	let body = `BT\n/F1 ${FONT_SIZE} Tf\n${LEADING} TL\n${MARGIN} ${PAGE_HEIGHT - MARGIN} Td\n`;
	for (const line of lines) body += line ? `${literal(line)} Tj T*\n` : 'T*\n';
	return `${body}ET`;
}

/**
 * Build a PDF with one page per string in `pages` (long text is wrapped; what
 * does not fit on a page is cut). `title` sets the document's title.
 * `outline` lists bookmarks: `page` is 1-based, `depth` (default 0) nests an
 * entry under the nearest earlier entry of lower depth. `namedDestinations`
 * makes each bookmark point at a named destination instead of directly at
 * its page, as many real PDFs do. Returns the file's bytes.
 *
 * @param {string[]} pages
 * @param {{ title?: string, outline?: { title: string, page: number, depth?: number }[], namedDestinations?: boolean }} [options]
 * @returns {Uint8Array}
 */
export function makePdf(pages, options = {}) {
	const { title, outline = [], namedDestinations = false } = options;
	/** @type {string[]} Index 0 is object 1; each a body. */
	const objects = [];
	/** @param {string} body */
	const add = (body) => objects.push(body);

	const catalogId = 1;
	const pagesId = 2;
	const fontId = 3;
	const infoId = 4;
	// Objects 5..: outline items, then pages.
	/** @typedef {{ id: number, children: Item[] }} Node */
	/** @typedef {Node & { title: string, page: number, depth: number, parent: Node }} Item */
	/** @type {Item[]} */
	const items = outline.map((entry, i) => ({ ...entry, depth: entry.depth ?? 0, id: 5 + 1 + i, children: [], parent: /** @type {Node} */ (/** @type {unknown} */ (null)) }));
	const outlinesId = 5;
	const firstPageId = 5 + 1 + items.length;
	/** @param {number} n */
	const pageId = (n) => firstPageId + 2 * (n - 1);

	// Outline tree: parent, first/last child, prev/next sibling.
	/** @type {Node} */
	const root = { id: outlinesId, children: [] };
	const stack = [{ node: root, depth: -1 }];
	for (const item of items) {
		while (stack[stack.length - 1].depth >= item.depth) stack.pop();
		const parent = stack[stack.length - 1].node;
		item.parent = parent;
		parent.children.push(item);
		stack.push({ node: item, depth: item.depth });
	}
	/** @param {Node} node @returns {number} */
	const descendants = (node) => node.children.reduce((n, c) => n + 1 + descendants(c), 0);

	/** @param {Item} item */
	const destFor = (item) => {
		const target = Math.min(Math.max(item.page, 1), Math.max(pages.length, 1));
		return namedDestinations ? `/Dest (dest${item.id})` : `/Dest [${pageId(target)} 0 R /Fit]`;
	};

	add(
		`<< /Type /Catalog /Pages ${pagesId} 0 R` +
			(items.length ? ` /Outlines ${outlinesId} 0 R` : '') +
			(namedDestinations && items.length
				? ` /Dests << ${items.map((it) => `/dest${it.id} [${pageId(Math.min(Math.max(it.page, 1), Math.max(pages.length, 1)))} 0 R /Fit]`).join(' ')} >>`
				: '') +
			' >>'
	);
	add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i + 1)} 0 R`).join(' ')}] >>`);
	add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	add(`<< /Producer (make-pdf.mjs)${title === undefined ? '' : ` /Title ${unicodeString(title)}`} >>`);
	// Object 5: the outline root (an empty dictionary when there are no bookmarks).
	add(
		items.length
			? `<< /Type /Outlines /First ${root.children[0].id} 0 R /Last ${root.children[root.children.length - 1].id} 0 R /Count ${descendants(root)} >>`
			: '<< /Type /Outlines /Count 0 >>'
	);
	for (const item of items) {
		const siblings = item.parent.children;
		const at = siblings.indexOf(item);
		add(
			`<< /Title ${unicodeString(item.title)} /Parent ${item.parent.id} 0 R ${destFor(item)}` +
				(at > 0 ? ` /Prev ${siblings[at - 1].id} 0 R` : '') +
				(at < siblings.length - 1 ? ` /Next ${siblings[at + 1].id} 0 R` : '') +
				(item.children.length ? ` /First ${item.children[0].id} 0 R /Last ${item.children[item.children.length - 1].id} 0 R /Count ${descendants(item)}` : '') +
				' >>'
		);
	}
	pages.forEach((text, i) => {
		const stream = pageStream(text);
		add(
			`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
				`/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${pageId(i + 1) + 1} 0 R >>`
		);
		add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
	});

	const parts = ['%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'];
	let offset = parts[0].length;
	/** @type {number[]} */
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(offset);
		const chunk = `${i + 1} 0 obj\n${body}\nendobj\n`;
		parts.push(chunk);
		offset += chunk.length;
	});
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
	xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
	parts.push(xref);

	// Every character is at most U+00FF, so one char is one byte.
	return Uint8Array.from(Buffer.from(parts.join(''), 'latin1'));
}

/** A PDF of `n` pages with nothing written on them, as a scan with no text layer reads. */
/** @param {number} n */
export function makeScannedPdf(n) {
	return makePdf(Array.from({ length: n }, () => ''));
}

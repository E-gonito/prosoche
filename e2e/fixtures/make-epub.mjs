/**
 * Builds small, valid EPUBs for the unit tests and the end-to-end tests, so no
 * binary book needs to be checked in. The only dependency is `fflate`, which
 * the app already uses to unpack them.
 *
 * What a built book looks like, in the layout most real EPUBs share:
 *
 *     mimetype                    stored first, uncompressed, as the spec asks
 *     META-INF/container.xml      points at the package document
 *     OEBPS/content.opf           title, manifest, spine
 *     OEBPS/nav.xhtml             EPUB 3 contents (version 3)
 *     OEBPS/toc.ncx               EPUB 2 contents (version 2)
 *     OEBPS/text/ch1.xhtml …      one XHTML file per chapter
 *     OEBPS/styles/book.css       one stylesheet
 *     OEBPS/images/dot.png        one image
 *
 * Chapters sit one folder below the package document on purpose: it makes the
 * code that resolves `../styles/book.css` and spine hrefs earn its keep.
 */

import { zipSync, unzipSync, strToU8 } from 'fflate';

/** A 1x1 transparent PNG. */
const PNG = Uint8Array.from(
	atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
	(c) => c.charCodeAt(0)
);

/** @param {unknown} s */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS = 'http://www.w3.org/1999/xhtml';

/**
 * @typedef {{ title: string, html: string, sections?: { id: string, title: string }[] }} EpubChapter
 *   `html` is the chapter's body markup and must be well-formed XML. `sections`
 *   are ids inside `html` that the contents list as children of the chapter.
 */

/**
 * A valid EPUB.
 *
 * @param {{ title?: string, chapters?: EpubChapter[], version?: 2 | 3 }} [opts]
 * @returns {Uint8Array}
 */
export function makeEpub({ title = 'A Small Book', chapters = defaultChapters(), version = 3 } = {}) {
	/** @type {import('fflate').Zippable} */
	const files = {};
	// The mimetype entry must come first and must not be compressed.
	files.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
	files['META-INF/container.xml'] = strToU8(
		`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
	);
	chapters.forEach((c, i) => {
		files[`OEBPS/text/ch${i + 1}.xhtml`] = strToU8(chapterXhtml(c));
	});
	files['OEBPS/styles/book.css'] = strToU8('body { font-family: serif; }\nh1 { color: #333; }\n');
	files['OEBPS/images/dot.png'] = PNG;

	const items = chapters.map((_, i) => `    <item id="ch${i + 1}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
	const spine = chapters.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n');

	if (version === 3) {
		files['OEBPS/nav.xhtml'] = strToU8(navXhtml(chapters));
		files['OEBPS/content.opf'] = strToU8(
			`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="dot" href="images/dot.png" media-type="image/png"/>
${items}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`
		);
	} else {
		files['OEBPS/toc.ncx'] = strToU8(ncx(chapters, title));
		files['OEBPS/content.opf'] = strToU8(
			`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${esc(title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uid" opf:scheme="UUID">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="dot" href="images/dot.png" media-type="image/png"/>
${items}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`
		);
	}
	return zipSync(files);
}

/**
 * An EPUB with an entry named to unpack outside the book's folder
 * (`../../evil.txt`) beside an otherwise valid book. A reader that trusts
 * entry names would write `evil.txt` two folders up.
 *
 * @returns {Uint8Array}
 */
export function makeZipSlipEpub() {
	const { mimetype, ...rest } = unzipSync(makeEpub({ title: 'Zip slip' }));
	return zipSync({
		mimetype: [mimetype, { level: 0 }],
		...rest,
		// fflate takes any entry name as given.
		'../../evil.txt': strToU8('escaped')
	});
}

/** Two chapters with a section each, an image and a stylesheet link. */
/** @returns {EpubChapter[]} */
function defaultChapters() {
	return [
		{
			title: 'First chapter',
			html: '<h1 id="top">First chapter</h1><p>It was the best of times.</p><img src="../images/dot.png" alt="dot"/><h2 id="part-a">Part A</h2><p>Some words in part A.</p>',
			sections: [{ id: 'part-a', title: 'Part A' }]
		},
		{ title: 'Second chapter', html: '<h1 id="top">Second chapter</h1><p>It was the worst of times.</p>' }
	];
}

/** @param {EpubChapter} c */
function chapterXhtml(c) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="${NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${esc(c.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body>
${c.html}
</body>
</html>
`;
}

/** @param {EpubChapter[]} chapters */
function navXhtml(chapters) {
	const li = chapters
		.map((c, i) => {
			const inner = c.sections?.length
				? `\n        <ol>\n${c.sections.map((s) => `          <li><a href="text/ch${i + 1}.xhtml#${esc(s.id)}">${esc(s.title)}</a></li>`).join('\n')}\n        </ol>\n      `
				: '';
			return `      <li><a href="text/ch${i + 1}.xhtml">${esc(c.title)}</a>${inner}</li>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="${NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${li}
    </ol>
  </nav>
</body>
</html>
`;
}

/**
 * @param {EpubChapter[]} chapters
 * @param {string} title
 */
function ncx(chapters, title) {
	let order = 0;
	const points = chapters
		.map((c, i) => {
			const own = ++order;
			const kids = (c.sections ?? [])
				.map((s) => `      <navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(s.title)}</text></navLabel><content src="text/ch${i + 1}.xhtml#${esc(s.id)}"/></navPoint>`)
				.join('\n');
			return `    <navPoint id="np${own}" playOrder="${own}">
      <navLabel><text>${esc(c.title)}</text></navLabel>
      <content src="text/ch${i + 1}.xhtml"/>
${kids}
    </navPoint>`;
		})
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:11111111-2222-3333-4444-555555555555"/></head>
  <docTitle><text>${esc(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

/**
 * `e2e/make-vault.mjs` imports every `.mjs` in this folder and calls its
 * default export for vault files. This is a builder of books, not of vault
 * notes, so it contributes none.
 *
 * @returns {Record<string, string>}
 */
export default function noVaultFiles() {
	return {};
}

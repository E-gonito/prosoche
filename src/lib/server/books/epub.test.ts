import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { makeEpub, makeZipSlipEpub } from '../../../../e2e/fixtures/make-epub.mjs';
import { Shelf } from '../vault/shelf';
import { unpackEpub } from './epub';
import { HTML_ROOT, ORIGINAL } from './manifest';

const ID = '0123456789abcdef';
let root: string;
let shelf: Shelf;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-epub-'));
	shelf = new Shelf(join(root, 'shelf'));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const put = (bytes: Uint8Array) => shelf.write(ID, ORIGINAL.epub, bytes);
const exists = (path: string) => stat(path).then(() => true, () => false);

const CONTAINER = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

/** A hand-made EPUB for the odd cases the fixture builder does not make. */
function custom(opts: { opf: string; extra?: Record<string, string>; container?: string | null }): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	if (opts.container !== null) files['META-INF/container.xml'] = strToU8(opts.container ?? CONTAINER);
	files['OEBPS/content.opf'] = strToU8(opts.opf);
	for (const [k, v] of Object.entries(opts.extra ?? {})) files[k] = strToU8(v);
	return zipSync(files);
}

const opf = (manifest: string, spine: string, title = 'T') =>
	`<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;

describe('unpackEpub', () => {
	for (const version of [3, 2] as const) {
		it(`reads title, spine and nested contents from an EPUB ${version}`, async () => {
			await put(makeEpub({ title: 'Tom & Jerry', version }));
			const r = await unpackEpub(shelf, ID);
			expect(r).toEqual({
				ok: true,
				title: 'Tom & Jerry',
				chapters: ['OEBPS/text/ch1.xhtml', 'OEBPS/text/ch2.xhtml'],
				contents: [
					{ title: 'First chapter', place: { kind: 'html', chapter: 'OEBPS/text/ch1.xhtml' }, depth: 0 },
					{ title: 'Part A', place: { kind: 'html', chapter: 'OEBPS/text/ch1.xhtml', anchor: 'part-a' }, depth: 1 },
					{ title: 'Second chapter', place: { kind: 'html', chapter: 'OEBPS/text/ch2.xhtml' }, depth: 0 }
				]
			});
		});
	}

	it('unpacks every entry under html/ at its path, byte for byte', async () => {
		const zip = makeEpub({});
		await put(zip);
		await unpackEpub(shelf, ID);
		const files = await shelf.files(ID);
		expect(files.filter((f) => f.startsWith(`${HTML_ROOT}/`))).toEqual(
			[
				'META-INF/container.xml',
				'OEBPS/content.opf',
				'OEBPS/images/dot.png',
				'OEBPS/nav.xhtml',
				'OEBPS/styles/book.css',
				'OEBPS/text/ch1.xhtml',
				'OEBPS/text/ch2.xhtml',
				'mimetype'
			].map((f) => `${HTML_ROOT}/${f}`)
		);
		expect(await shelf.readText(ID, `${HTML_ROOT}/OEBPS/text/ch2.xhtml`)).toContain('It was the worst of times.');
		expect(await exists(join(root, 'shelf', ID, `${HTML_ROOT}.new`))).toBe(false);
	});

	it('replaces an html/ folder already there', async () => {
		await shelf.write(ID, `${HTML_ROOT}/stale.html`, 'old');
		await put(makeEpub({}));
		await unpackEpub(shelf, ID);
		expect(await shelf.read(ID, `${HTML_ROOT}/stale.html`)).toBeNull();
		expect(await shelf.read(ID, `${HTML_ROOT}/mimetype`)).not.toBeNull();
	});

	it('refuses a zip-slip entry and leaves nothing outside or in html/', async () => {
		await put(makeZipSlipEpub());
		const r = await unpackEpub(shelf, ID);
		expect(r).toMatchObject({ ok: false, reason: 'bad-epub' });
		expect((r as { message: string }).message).toMatch(/outside/);
		expect(await exists(join(root, 'evil.txt'))).toBe(false);
		expect(await exists(join(root, 'shelf', 'evil.txt'))).toBe(false);
		expect(await shelf.files(ID)).toEqual([ORIGINAL.epub]);
	});

	it('refuses an entry that would overwrite the manifest, which is inside the book folder but outside html/', async () => {
		const zip = zipSync({ ...{ 'META-INF/container.xml': strToU8(CONTAINER) }, 'OEBPS/content.opf': strToU8(opf('', '')), '../book.json': strToU8('{}') });
		await put(zip);
		const r = await unpackEpub(shelf, ID);
		expect(r).toMatchObject({ ok: false, reason: 'bad-epub' });
		expect(await shelf.read(ID, 'book.json')).toBeNull();
	});

	it('refuses absolute and backslash escapes', async () => {
		for (const name of ['/etc/x', '..\\..\\x', 'a/../../x']) {
			await put(zipSync({ [name]: strToU8('x'), 'META-INF/container.xml': strToU8(CONTAINER) }));
			expect(await unpackEpub(shelf, ID), name).toMatchObject({ ok: false, reason: 'bad-epub' });
		}
	});

	it('refuses a corrupt zip, a missing original, and a book with no container or OPF', async () => {
		await put(strToU8('this is not a zip file at all'));
		expect(await unpackEpub(shelf, ID)).toMatchObject({ ok: false, reason: 'bad-epub' });
		expect(await shelf.files(ID)).toEqual([ORIGINAL.epub]);

		await shelf.remove(ID);
		expect(await unpackEpub(shelf, ID)).toMatchObject({ ok: false, reason: 'bad-epub', message: expect.stringMatching(/missing/) });

		await put(custom({ opf: opf('', ''), container: null }));
		expect(await unpackEpub(shelf, ID)).toMatchObject({ ok: false, message: expect.stringMatching(/container\.xml/) });

		await put(zipSync({ 'META-INF/container.xml': strToU8(CONTAINER) }));
		expect(await unpackEpub(shelf, ID)).toMatchObject({ ok: false, message: expect.stringMatching(/package document/) });
		expect(await shelf.files(ID)).toEqual([ORIGINAL.epub]);
	});

	it('keeps the html/ it had when the new unpack is refused', async () => {
		await shelf.write(ID, `${HTML_ROOT}/keep.html`, 'kept');
		await put(makeZipSlipEpub());
		await unpackEpub(shelf, ID);
		expect(await shelf.readText(ID, `${HTML_ROOT}/keep.html`)).toBe('kept');
	});

	it('refuses an empty spine', async () => {
		await put(custom({ opf: opf('<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>', '') }));
		expect(await unpackEpub(shelf, ID)).toMatchObject({ ok: false, message: expect.stringMatching(/no readable chapters/) });
	});

	it('keeps linear="no" items, drops spine items with no file, and resolves percent-encoded hrefs', async () => {
		await put(
			custom({
				opf: opf(
					'<item id="a" href="a%20b.xhtml" media-type="application/xhtml+xml"/><item id="n" href="notes.xhtml" media-type="application/xhtml+xml"/><item id="gone" href="gone.xhtml" media-type="application/xhtml+xml"/>',
					'<itemref idref="a"/><itemref idref="n" linear="no"/><itemref idref="gone"/><itemref idref="nothere"/>'
				),
				extra: { 'OEBPS/a b.xhtml': '<html><head><title>Alpha</title></head><body/></html>', 'OEBPS/notes.xhtml': '<html><head><title>Notes</title></head><body/></html>' }
			})
		);
		const r = await unpackEpub(shelf, ID);
		expect(r).toMatchObject({ ok: true, chapters: ['OEBPS/a b.xhtml', 'OEBPS/notes.xhtml'] });
	});

	it('falls back to one contents entry per chapter, titled by the chapter, when there is no nav or NCX', async () => {
		await put(
			custom({
				opf: opf('<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>', '<itemref idref="a"/><itemref idref="b"/>'),
				extra: { 'OEBPS/a.xhtml': '<html><head><title>Alpha</title></head><body/></html>', 'OEBPS/b.xhtml': '<html><body/></html>' }
			})
		);
		const r = await unpackEpub(shelf, ID);
		expect(r).toMatchObject({
			ok: true,
			contents: [
				{ title: 'Alpha', place: { kind: 'html', chapter: 'OEBPS/a.xhtml' }, depth: 0 },
				{ title: 'b', place: { kind: 'html', chapter: 'OEBPS/b.xhtml' }, depth: 0 }
			]
		});
	});

	it('gives a heading without a link the place of its first child, and nests the children under it', async () => {
		const nav = `<html xmlns:epub="x"><body><nav epub:type="landmarks"><ol><li><a href="a.xhtml">Cover</a></li></ol></nav><nav epub:type="toc"><ol><li><span>Part One</span><ol><li><a href="a.xhtml#s">Alpha</a></li><li><a href="b.xhtml">Beta</a></li></ol></li><li><span>Empty part</span></li></ol></nav></body></html>`;
		await put(
			custom({
				opf: opf(
					'<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>',
					'<itemref idref="a"/><itemref idref="b"/>'
				),
				extra: { 'OEBPS/nav.xhtml': nav, 'OEBPS/a.xhtml': '<html/>', 'OEBPS/b.xhtml': '<html/>' }
			})
		);
		const r = await unpackEpub(shelf, ID);
		expect(r).toMatchObject({
			ok: true,
			contents: [
				{ title: 'Part One', place: { kind: 'html', chapter: 'OEBPS/a.xhtml', anchor: 's' }, depth: 0 },
				{ title: 'Alpha', place: { kind: 'html', chapter: 'OEBPS/a.xhtml', anchor: 's' }, depth: 1 },
				{ title: 'Beta', place: { kind: 'html', chapter: 'OEBPS/b.xhtml' }, depth: 1 }
			]
		});
	});

	it('leaves the original in place', async () => {
		const zip = makeEpub({});
		await put(zip);
		await unpackEpub(shelf, ID);
		expect(new Uint8Array(await readFile(join(root, 'shelf', ID, ORIGINAL.epub)))).toEqual(zip);
	});
});

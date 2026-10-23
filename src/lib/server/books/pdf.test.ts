import { describe, it, expect } from 'vitest';
import { makePdf, makeScannedPdf } from '../../../../e2e/fixtures/make-pdf.mjs';
import { cleanTitle, openPdfText, readPdf } from './pdf';

describe('cleanTitle', () => {
	it.each([
		['Computer Systems: A Programmer’s Perspective', 'Computer Systems: A Programmer’s Perspective'],
		['  Spaced \n  out  ', 'Spaced out'],
		['Microsoft Word - Chapter 3 notes', 'Chapter 3 notes'],
		['Microsoft Word - x.doc', null],
		['Microsoft PowerPoint - slides.pptx', null],
		['notes.docx', null],
		['Untitled', null],
		['untitled1', null],
		['', null],
		['   ', null],
		[undefined, null],
		[42, null],
		['A'.repeat(300), 'A'.repeat(200)]
	])('%j -> %j', (raw, want) => {
		expect(cleanTitle(raw)).toBe(want);
	});
});

describe('readPdf', () => {
	it('reads the page count and a real title', async () => {
		const bytes = makePdf(['one', 'two', 'three'], { title: 'The Book' });
		expect(await readPdf(bytes)).toEqual({ ok: true, title: 'The Book', pages: 3, contents: [] });
	});

	it('leaves the caller their bytes', async () => {
		const bytes = makePdf(['one']);
		await readPdf(bytes);
		expect(bytes.byteLength).toBeGreaterThan(0);
	});

	it('has no title for a blank or tool-made one', async () => {
		expect((await readPdf(makePdf(['a']))) as { title: unknown }).toMatchObject({ title: null });
		expect((await readPdf(makePdf(['a'], { title: 'Microsoft Word - x.doc' }))) as { title: unknown }).toMatchObject({ title: null });
		expect((await readPdf(makePdf(['a'], { title: 'Microsoft Word - Real name' }))) as { title: unknown }).toMatchObject({ title: 'Real name' });
	});

	it('flattens a nested outline into page places with depths', async () => {
		const bytes = makePdf(['a', 'b', 'c', 'd'], {
			outline: [
				{ title: 'Part I', page: 1 },
				{ title: 'Chapter 1', page: 2, depth: 1 },
				{ title: 'Section 1.1', page: 3, depth: 2 },
				{ title: 'Chapter 2', page: 4, depth: 1 },
				{ title: 'Part II', page: 4 }
			]
		});
		const r = await readPdf(bytes);
		expect(r.ok && r.contents).toEqual([
			{ title: 'Part I', place: { kind: 'page', page: 1 }, depth: 0 },
			{ title: 'Chapter 1', place: { kind: 'page', page: 2 }, depth: 1 },
			{ title: 'Section 1.1', place: { kind: 'page', page: 3 }, depth: 2 },
			{ title: 'Chapter 2', place: { kind: 'page', page: 4 }, depth: 1 },
			{ title: 'Part II', place: { kind: 'page', page: 4 }, depth: 0 }
		]);
	});

	it('resolves named destinations', async () => {
		const r = await readPdf(makePdf(['a', 'b'], { outline: [{ title: 'Second', page: 2 }], namedDestinations: true }));
		expect(r.ok && r.contents).toEqual([{ title: 'Second', place: { kind: 'page', page: 2 }, depth: 0 }]);
	});

	it.each([
		['empty', new Uint8Array(0)],
		['text', new TextEncoder().encode('not a pdf at all')],
		['truncated', makePdf(['a', 'b']).slice(0, 120)]
	])('refuses %s bytes as bad-pdf without throwing', async (_name, bytes) => {
		const r = await readPdf(bytes);
		expect(r).toMatchObject({ ok: false, reason: 'bad-pdf' });
	});
});

describe('openPdfText', () => {
	it('gives a page its text, lines apart', async () => {
		const pdf = await openPdfText(makePdf(['First line\nSecond line', 'Other page']));
		expect(pdf?.pages).toBe(2);
		expect((await pdf?.page(1))?.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual(['First line', 'Second line']);
		expect(await pdf?.page(2)).toContain('Other page');
		expect(await pdf?.page(99)).toBe('');
		await pdf?.close();
	});

	it('gives nothing for a page with no text, and null for bad bytes', async () => {
		const pdf = await openPdfText(makeScannedPdf(2));
		expect((await pdf?.page(1))?.trim()).toBe('');
		await pdf?.close();
		expect(await openPdfText(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});

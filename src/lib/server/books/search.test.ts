import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf, makeScannedPdf } from '../../../../e2e/fixtures/make-pdf.mjs';
import { NoteIndex } from '../index/index';
import { Shelf } from '../vault/shelf';
import type { BookManifest } from '$lib/shared/books';
import { readManifest, writeManifest } from './manifest';
import { forgetBookText, queueText, reindexBooks, searchBooks, textIdle } from './search';

let root: string;
let shelf: Shelf;
let index: NoteIndex;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-search-'));
	shelf = new Shelf(root);
	index = new NoteIndex(':memory:');
	vi.spyOn(console, 'log').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
	await textIdle();
	index.close();
	vi.restoreAllMocks();
	await rm(root, { recursive: true, force: true });
});

const manifest = (id: string, over: Partial<BookManifest> = {}): BookManifest => ({
	id,
	format: 'pdf',
	title: `Title of ${id}`,
	source: 'x.pdf',
	bytes: 0,
	pages: 2,
	contents: [],
	scripts: false,
	text: { state: 'pending' },
	savedAt: '2026-10-23T00:00:00Z',
	...over
});

async function addPdf(id: string, pages: string[], over: Partial<BookManifest> = {}) {
	await shelf.write(id, 'original.pdf', makePdf(pages));
	await writeManifest(shelf, manifest(id, { pages: pages.length, ...over }));
}

describe('queueText', () => {
	it('extracts, records the state, and makes the text searchable', async () => {
		await addPdf('book-aaaa', ['Pointers and memory layout', 'The linker resolves symbols']);
		queueText(shelf, index, 'book-aaaa');
		await textIdle();
		expect((await readManifest(shelf, 'book-aaaa'))?.text).toEqual({ state: 'done', parts: 2 });
		const hits = await searchBooks(index, shelf, 'linker');
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ book: 'book-aaaa', title: 'Title of book-aaaa', place: { kind: 'page', page: 2 }, label: 'p. 2' });
		expect(hits[0].snippet).toContain('«linker»');
	});

	it('works through several books one after another, and a duplicate does nothing more', async () => {
		await addPdf('book-aaaa', ['alpha one']);
		await addPdf('book-bbbb', ['beta two']);
		queueText(shelf, index, 'book-aaaa');
		queueText(shelf, index, 'book-bbbb');
		queueText(shelf, index, 'book-bbbb');
		await textIdle();
		expect((await searchBooks(index, shelf, 'alpha')).map((h) => h.book)).toEqual(['book-aaaa']);
		expect((await searchBooks(index, shelf, 'beta')).map((h) => h.book)).toEqual(['book-bbbb']);
		const starts = vi.mocked(console.log).mock.calls.filter((c) => String(c[0]).includes('started'));
		expect(starts).toHaveLength(2);
		expect(String(starts[0][0])).toContain('[books] text book-aaaa');
	});

	it('records a scan as none and a missing book as nothing at all', async () => {
		await shelf.write('book-scan', 'original.pdf', makeScannedPdf(3));
		await writeManifest(shelf, manifest('book-scan', { pages: 3 }));
		queueText(shelf, index, 'book-scan');
		queueText(shelf, index, 'book-gone');
		await textIdle();
		expect((await readManifest(shelf, 'book-scan'))?.text).toEqual({ state: 'none' });
		expect(await readManifest(shelf, 'book-gone')).toBeNull();
	});

	it('records a failure and carries on with the next book', async () => {
		await shelf.write('book-bad1', 'original.pdf', new Uint8Array([1, 2, 3]));
		await writeManifest(shelf, manifest('book-bad1'));
		await addPdf('book-good', ['fine words']);
		queueText(shelf, index, 'book-bad1');
		queueText(shelf, index, 'book-good');
		await textIdle();
		expect((await readManifest(shelf, 'book-bad1'))?.text.state).toBe('failed');
		expect((await readManifest(shelf, 'book-good'))?.text.state).toBe('done');
	});

	it('extracts an HTML book by section', async () => {
		await shelf.write('s-site0001', 'html/a.html', '<title>Ch A</title><h1 id="own">Ownership</h1><p>Each value has an owner.</p>');
		await writeManifest(shelf, manifest('s-site0001', { format: 'site', pages: undefined, chapters: ['a.html'], scripts: true }));
		queueText(shelf, index, 's-site0001');
		await textIdle();
		const [hit] = await searchBooks(index, shelf, 'owner');
		expect(hit).toMatchObject({ book: 's-site0001', place: { kind: 'html', chapter: 'a.html', anchor: 'own' }, label: 'Ownership' });
	});
});

describe('reindexBooks', () => {
	it('loads text.json into the index without extracting again, and queues what was unfinished', async () => {
		await addPdf('book-aaaa', ['linker words']);
		queueText(shelf, index, 'book-aaaa');
		await textIdle();
		await addPdf('book-bbbb', ['pending pages'], { text: { state: 'pending' } });
		await addPdf('book-cccc', ['running pages'], { text: { state: 'running', done: 1, total: 1 } });

		const fresh = new NoteIndex(':memory:');
		try {
			vi.mocked(console.log).mockClear();
			await reindexBooks(shelf, fresh);
			// aaaa was loaded from its file, without a second extraction.
			expect(fresh.searchBookText('linker')).toHaveLength(1);
			await textIdle();
			const started = vi.mocked(console.log).mock.calls.map((c) => String(c[0])).filter((l) => l.includes('started'));
			expect(started.map((l) => /book-\w+/.exec(l)?.[0]).sort()).toEqual(['book-bbbb', 'book-cccc']);
			expect(fresh.searchBookText('pending')).toHaveLength(1);
			expect(fresh.searchBookText('running')).toHaveLength(1);
		} finally {
			await textIdle();
			fresh.close();
		}
	});

	it('skips a folder with no manifest and survives an empty shelf', async () => {
		await reindexBooks(shelf, index);
		await shelf.write('book-nope', 'text.json', '[]');
		await expect(reindexBooks(shelf, index)).resolves.toBeUndefined();
	});
});

describe('searchBooks and forgetBookText', () => {
	it('limits to one book, drops hits for books off the shelf, and forgets', async () => {
		await addPdf('book-aaaa', ['shared term here']);
		await addPdf('book-bbbb', ['shared term there']);
		queueText(shelf, index, 'book-aaaa');
		queueText(shelf, index, 'book-bbbb');
		await textIdle();
		expect(await searchBooks(index, shelf, 'shared')).toHaveLength(2);
		expect((await searchBooks(index, shelf, 'shared', { book: 'book-bbbb' })).map((h) => h.book)).toEqual(['book-bbbb']);
		expect(await searchBooks(index, shelf, 'shared', { limit: 1 })).toHaveLength(1);
		await shelf.remove('book-aaaa');
		expect((await searchBooks(index, shelf, 'shared')).map((h) => h.book)).toEqual(['book-bbbb']);
		forgetBookText(index, 'book-bbbb');
		expect(await searchBooks(index, shelf, 'shared')).toEqual([]);
	});

	it('answers no hits for an empty or unparsable query', async () => {
		expect(await searchBooks(index, shelf, '')).toEqual([]);
		expect(await searchBooks(index, shelf, '"')).toEqual([]);
	});

	it('keeps a chapter path with a space', async () => {
		index.putBookText('book-epub', [{ place: 'OEBPS/Chapter 1.xhtml#s1', label: 'S1', text: 'zebra' }]);
		await writeManifest(shelf, manifest('book-epub', { format: 'epub' }));
		expect((await searchBooks(index, shelf, 'zebra'))[0].place).toEqual({ kind: 'html', chapter: 'OEBPS/Chapter 1.xhtml', anchor: 's1' });
	});
});

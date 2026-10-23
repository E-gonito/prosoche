import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Vault } from '../vault/index';
import { Shelf } from '../vault/shelf';
import type { NoteIndex } from '../index/index';

vi.mock('./pdf', () => ({ readPdf: vi.fn() }));
vi.mock('./epub', () => ({ unpackEpub: vi.fn() }));
vi.mock('./site', () => ({ saveSite: vi.fn() }));
vi.mock('./search', () => ({ queueText: vi.fn(), forgetBookText: vi.fn(), reindexBooks: vi.fn() }));

import { readPdf } from './pdf';
import { unpackEpub } from './epub';
import { saveSite } from './site';
import { forgetBookText, queueText } from './search';
import { addHighlight, addSite, addUpload, fileName, getBook, listBooks, removeBook, savePlace } from './library';
import { fileId, siteId } from './id';
import { readManifest } from './manifest';
import { newBookNote, readBookNote } from './note';

let vaultRoot: string;
let shelfRoot: string;
let vault: Vault;
let shelf: Shelf;
const index = {} as NoteIndex;
const NOW = new Date(2026, 9, 23, 12, 0, 0);

beforeEach(async () => {
	vaultRoot = await mkdtemp(join(tmpdir(), 'hub-lib-vault-'));
	shelfRoot = await mkdtemp(join(tmpdir(), 'hub-lib-shelf-'));
	vault = new Vault(vaultRoot);
	shelf = new Shelf(shelfRoot);
	vi.mocked(readPdf).mockReset().mockResolvedValue({ ok: true, title: 'CS:APP', pages: 1120, contents: [] });
	vi.mocked(unpackEpub).mockReset().mockResolvedValue({ ok: true, title: 'An EPUB', chapters: ['a.xhtml'], contents: [] });
	vi.mocked(saveSite).mockReset().mockResolvedValue({ ok: true, title: 'The Site', chapters: ['index.html'], contents: [] });
	vi.mocked(queueText).mockReset();
	vi.mocked(forgetBookText).mockReset();
});
afterEach(async () => {
	await vault.close();
	await rm(vaultRoot, { recursive: true, force: true });
	await rm(shelfRoot, { recursive: true, force: true });
});

const stream = (text: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
const idOf = (text: string) => fileId(createHash('sha256').update(text).digest('hex'));
const upload = (text = 'pdf bytes', name = 'csapp.pdf', type = 'application/pdf') => addUpload(vault, shelf, index, { type, name, body: stream(text) }, NOW);
const read = async (path: string) => readFile(join(vaultRoot, path), 'utf8');

describe('addUpload', () => {
	it('stores a PDF under the hash of its bytes, writes its manifest and note, and queues its text', async () => {
		const id = idOf('pdf bytes');
		const added = await upload();
		expect(added).toEqual({ ok: true, id, note: 'Books/CS-APP.md', title: 'CS:APP', existing: false });
		expect(await shelf.ids()).toEqual([id]);
		expect(await readManifest(shelf, id)).toMatchObject({ id, format: 'pdf', title: 'CS:APP', source: 'csapp.pdf', pages: 1120, scripts: false, text: { state: 'pending' }, bytes: 9, savedAt: NOW.toISOString() });
		expect(await read('Books/CS-APP.md')).toBe(newBookNote({ id, format: 'pdf', source: 'csapp.pdf', added: '2026-10-23' }));
		expect(queueText).toHaveBeenCalledWith(shelf, index, id);
	});

	it('takes the file name when the PDF has no title', async () => {
		vi.mocked(readPdf).mockResolvedValue({ ok: true, title: null, pages: 3, contents: [] });
		expect(await upload('x', 'My Notes.v2.pdf')).toMatchObject({ ok: true, title: 'My Notes.v2', note: 'Books/My Notes.v2.md' });
	});

	it('unpacks an EPUB and records its chapters', async () => {
		const added = await upload('epub bytes', 'a.epub', 'application/epub+zip');
		expect(added).toMatchObject({ ok: true, title: 'An EPUB' });
		if (!added.ok) return;
		expect(unpackEpub).toHaveBeenCalledWith(shelf, added.id);
		expect(await readManifest(shelf, added.id)).toMatchObject({ format: 'epub', chapters: ['a.xhtml'] });
	});

	it('knows the same file again, keeps its note and place, and stores nothing twice', async () => {
		const first = await upload();
		if (!first.ok) throw new Error('first');
		await savePlace(vault, first.id, { kind: 'page', page: 412 }, NOW);
		const again = await upload();
		expect(again).toMatchObject({ ok: true, id: first.id, existing: true, note: first.note });
		expect(await shelf.ids()).toEqual([first.id]);
		expect(readPdf).toHaveBeenCalledTimes(1);
		expect(readBookNote(await read(first.note))?.at).toEqual({ kind: 'page', page: 412 });
	});

	it('finds the note again for a file added after the shelf was lost', async () => {
		const first = await upload();
		if (!first.ok) throw new Error('first');
		await removeBook(shelf, index, first.id);
		expect((await listBooks(vault, shelf))[0].onShelf).toBe(false);
		expect(await upload()).toMatchObject({ ok: true, id: first.id, existing: true });
		expect((await listBooks(vault, shelf))[0].onShelf).toBe(true);
	});

	it('finds a note the author renamed', async () => {
		const first = await upload();
		if (!first.ok) throw new Error('first');
		await vault.write('Books/Renamed.md', await read(first.note));
		await rm(join(vaultRoot, first.note));
		expect(await upload()).toMatchObject({ existing: true, note: 'Books/Renamed.md' });
	});

	it('gives a second book with the same title a number', async () => {
		await upload('one');
		expect(await upload('two')).toMatchObject({ ok: true, note: 'Books/CS-APP (2).md' });
		expect(await upload('three')).toMatchObject({ note: 'Books/CS-APP (3).md' });
	});

	it('makes one note when the same file is uploaded twice at once', async () => {
		const [a, b] = await Promise.all([upload('same'), upload('same')]);
		expect(a).toMatchObject({ ok: true });
		expect(b).toMatchObject({ ok: true });
		expect((await listBooks(vault, shelf)).length).toBe(1);
	});

	it('refuses another type without touching the shelf', async () => {
		expect(await upload('x', 'a.txt', 'text/plain')).toMatchObject({ ok: false, reason: 'bad-type' });
		expect(await shelf.ids()).toEqual([]);
	});

	it('leaves nothing on the shelf or in the vault for a PDF that will not open', async () => {
		vi.mocked(readPdf).mockResolvedValue({ ok: false, reason: 'bad-pdf', message: 'Encrypted.' });
		expect(await upload()).toEqual({ ok: false, reason: 'bad-pdf', message: 'Encrypted.' });
		expect(await shelf.ids()).toEqual([]);
		expect(await vault.files('Books', 'md')).toEqual([]);
		expect(queueText).not.toHaveBeenCalled();
	});

	it('leaves nothing for an EPUB that will not open', async () => {
		vi.mocked(unpackEpub).mockResolvedValue({ ok: false, reason: 'bad-epub', message: 'No.' });
		expect(await upload('e', 'a.epub', 'application/epub+zip')).toMatchObject({ ok: false, reason: 'bad-epub' });
		expect(await shelf.ids()).toEqual([]);
	});

	it('refuses a file over the limit and drops the temporary folder', async () => {
		const spy = vi.spyOn(shelf, 'putStream').mockResolvedValue({ ok: false, reason: 'too-large' });
		expect(await upload('y')).toMatchObject({ ok: false, reason: 'too-large' });
		spy.mockRestore();
		expect((await shelf.ids()).filter((i) => i.startsWith('tmp-'))).toEqual([]);
	});
});

describe('addSite', () => {
	const URL_ = 'https://example.org/book/';

	it('saves a copy, writes the manifest and note, and queues the text', async () => {
		const id = siteId(URL_)!;
		const added = await addSite(vault, shelf, index, URL_, NOW);
		expect(added).toEqual({ ok: true, id, note: 'Books/The Site.md', title: 'The Site', existing: false });
		expect(saveSite).toHaveBeenCalledWith(shelf, id, URL_);
		expect(await readManifest(shelf, id)).toMatchObject({ format: 'site', scripts: true, source: URL_, chapters: ['index.html'], text: { state: 'pending' } });
		expect(readBookNote(await read('Books/The Site.md'))).toMatchObject({ id, format: 'site', source: URL_ });
		expect(queueText).toHaveBeenCalledWith(shelf, index, id);
	});

	it('refreshes a copy and keeps the note, place and highlights', async () => {
		const first = await addSite(vault, shelf, index, URL_, NOW);
		if (!first.ok) throw new Error('first');
		await savePlace(vault, first.id, { kind: 'html', chapter: 'ch1.html' }, NOW);
		await addHighlight(vault, first.id, { quote: 'q', place: { kind: 'html', chapter: 'ch1.html' } });
		const before = await read(first.note);
		const again = await addSite(vault, shelf, index, `${URL_}index.html#x`, NOW);
		expect(again).toMatchObject({ ok: true, id: first.id, existing: true });
		expect(await read(first.note)).toBe(before);
		expect(queueText).toHaveBeenCalledTimes(2);
	});

	it.each(['', 'ftp://x/y', 'not a url', 'javascript:alert(1)'])('refuses %j as bad-url', async (url) => {
		expect(await addSite(vault, shelf, index, url, NOW)).toMatchObject({ ok: false, reason: 'bad-url' });
		expect(saveSite).not.toHaveBeenCalled();
	});

	it('passes on a refusal and leaves nothing for a first save', async () => {
		vi.mocked(saveSite).mockResolvedValue({ ok: false, reason: 'unreachable', message: 'Nobody home.' });
		expect(await addSite(vault, shelf, index, URL_, NOW)).toEqual({ ok: false, reason: 'unreachable', message: 'Nobody home.' });
		expect(await shelf.ids()).toEqual([]);
		expect(await vault.files('Books', 'md')).toEqual([]);
	});
});

describe('listBooks and getBook', () => {
	it('lists newest read first, never-read last, then by title, with the place named', async () => {
		const a = await upload('a', 'a.pdf');
		const b = await upload('b', 'b.pdf');
		const c = await upload('c', 'c.pdf');
		if (!a.ok || !b.ok || !c.ok) throw new Error('add');
		await savePlace(vault, a.id, { kind: 'page', page: 5 }, new Date(2026, 9, 1));
		await savePlace(vault, b.id, { kind: 'page', page: 412 }, new Date(2026, 9, 20));
		const books = await listBooks(vault, shelf);
		expect(books.map((x) => x.id)).toEqual([b.id, a.id, c.id]);
		expect(books[0]).toMatchObject({ readAt: '2026-10-20', at: { kind: 'page', page: 412 }, atLabel: 'p. 412 of 1,120', onShelf: true, pages: 1120, text: { state: 'pending' } });
		expect(books[2]).toMatchObject({ at: null, atLabel: null, readAt: null });
	});

	it('ignores notes that are not book notes, and other folders', async () => {
		await vault.write('Books/Plain.md', '# Not a book\n');
		await vault.write('Other/Book.md', newBookNote({ id: '0123456789abcdef', format: 'pdf', source: 's', added: '2026-10-23' }));
		await vault.write('Books/Nested/Deep.md', newBookNote({ id: '0123456789abcdef', format: 'pdf', source: 's', added: '2026-10-23' }));
		expect(await listBooks(vault, shelf)).toEqual([]);
	});

	it('lists a note whose files are gone as not on the shelf', async () => {
		await vault.write('Books/Lost.md', newBookNote({ id: '0123456789abcdef', format: 'epub', source: 'lost.epub', added: '2026-10-23' }));
		expect(await listBooks(vault, shelf)).toMatchObject([{ title: 'Lost', onShelf: false, format: 'epub', source: 'lost.epub' }]);
	});

	it('opens a book with its manifest and highlights, and is null for a stranger', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		await addHighlight(vault, a.id, { quote: 'words', place: { kind: 'page', page: 2 }, comment: 'hm' });
		const open = await getBook(vault, shelf, a.id);
		expect(open?.book.id).toBe(a.id);
		expect(open?.manifest?.pages).toBe(1120);
		expect(open?.highlights).toMatchObject([{ quote: 'words', comment: 'hm' }]);
		expect(await getBook(vault, shelf, '0000000000000000')).toBeNull();
		expect(await getBook(vault, shelf, '../etc')).toBeNull();
	});
});

describe('savePlace', () => {
	it('sets at: and read_at: and nothing else', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		const before = await read(a.note);
		expect(await savePlace(vault, a.id, { kind: 'page', page: 412 }, NOW)).toEqual({ ok: true });
		const after = await read(a.note);
		expect(after.split('\n').filter((l) => !before.split('\n').includes(l))).toEqual(['at: p. 412', 'read_at: "2026-10-23"']);
	});

	it('is not found for an id with no note or a bad id', async () => {
		expect(await savePlace(vault, '0000000000000000', { kind: 'page', page: 1 }, NOW)).toEqual({ ok: false, reason: 'not-found' });
		expect(await savePlace(vault, 'nope', { kind: 'page', page: 1 }, NOW)).toEqual({ ok: false, reason: 'not-found' });
	});

	it('wins over a write that lands between its read and its write', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		const real = vault.write.bind(vault);
		let raced = false;
		vi.spyOn(vault, 'write').mockImplementation(async (path, content, hash, opts) => {
			if (!raced && hash !== undefined) {
				raced = true;
				await writeFile(join(vaultRoot, path), `${await readFile(join(vaultRoot, path), 'utf8')}\nobsidian line\n`);
			}
			return real(path, content, hash, opts);
		});
		expect(await savePlace(vault, a.id, { kind: 'page', page: 9 }, NOW)).toEqual({ ok: true });
		const text = await read(a.note);
		expect(text).toContain('obsidian line');
		expect(readBookNote(text)?.at).toEqual({ kind: 'page', page: 9 });
	});

	it('answers conflict when both tries clash', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		vi.spyOn(vault, 'write').mockImplementation(async (path, content) => ({ ok: false, reason: 'conflict', current: await vault.read(path), yourContent: content }));
		expect(await savePlace(vault, a.id, { kind: 'page', page: 9 }, NOW)).toEqual({ ok: false, reason: 'conflict' });
	});
});

describe('addHighlight', () => {
	it('adds the line and answers the highlight with its line number', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		const one = await addHighlight(vault, a.id, { quote: ' first\nquote ', place: { kind: 'page', page: 3 } });
		expect(one).toEqual({ ok: true, highlight: { quote: 'first quote', place: { kind: 'page', page: 3 }, line: 9 } });
		const two = await addHighlight(vault, a.id, { quote: 'second', place: { kind: 'page', page: 4 }, comment: 'because' });
		expect(two).toMatchObject({ ok: true, highlight: { quote: 'second', comment: 'because', line: 10 } });
		expect((await read(a.note)).split('\n').slice(7)).toEqual(['## Highlights', '', '- > first quote — p. 3', '- > second — p. 4', '\t- because', '']);
	});

	it('refuses no words and an unknown book', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		expect(await addHighlight(vault, a.id, { quote: '  ', place: { kind: 'page', page: 1 } })).toEqual({ ok: false, reason: 'no-text' });
		expect(await addHighlight(vault, '0000000000000000', { quote: 'x', place: { kind: 'page', page: 1 } })).toEqual({ ok: false, reason: 'not-found' });
	});
});

describe('removeBook', () => {
	it('removes the files and the text, and keeps the note', async () => {
		const a = await upload();
		if (!a.ok) throw new Error('add');
		expect(await removeBook(shelf, index, a.id)).toEqual({ ok: true });
		expect(await shelf.ids()).toEqual([]);
		expect(forgetBookText).toHaveBeenCalledWith(index, a.id);
		expect(await read(a.note)).toContain(a.id);
	});

	it('does nothing for a bad id or a book that is not there', async () => {
		expect(await removeBook(shelf, index, '../../x')).toEqual({ ok: true });
		expect(await removeBook(shelf, index, '0000000000000000')).toEqual({ ok: true });
		expect(forgetBookText).toHaveBeenCalledTimes(1);
	});
});

describe('fileName', () => {
	it.each([
		['CS:APP', 'CS-APP'],
		['a/b\\c*d?e"f<g>h|i#j^k[l]m', 'a-b-c-d-e-f-g-h-i-j-k-l-m'],
		['  spaced \n out  ', 'spaced out'],
		['..hidden.', 'hidden'],
		['', 'Untitled book'],
		['...', 'Untitled book'],
		['x'.repeat(200), 'x'.repeat(120)]
	])('%j becomes %j', (raw, want) => {
		expect(fileName(raw)).toBe(want);
	});
});

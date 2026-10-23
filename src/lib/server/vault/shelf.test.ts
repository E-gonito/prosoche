import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Shelf, ShelfPathError } from './shelf';

let root: string;
let shelf: Shelf;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-shelf-'));
	shelf = new Shelf(root);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

const streamOf = (...chunks: string[]) =>
	new ReadableStream<Uint8Array>({
		start(c) {
			for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
			c.close();
		}
	});

const text = async (body: ReadableStream<Uint8Array>) => new TextDecoder().decode(new Uint8Array(await new Response(body).arrayBuffer()));

describe('putStream', () => {
	it('writes the bytes, counts them and hashes them', async () => {
		const put = await shelf.putStream('abcd1234', 'original.pdf', streamOf('hello ', 'world'));
		expect(put).toEqual({ ok: true, bytes: 11, sha256: createHash('sha256').update('hello world').digest('hex') });
		expect(await shelf.readText('abcd1234', 'original.pdf')).toBe('hello world');
	});

	it('refuses a stream over the limit and leaves nothing behind', async () => {
		expect(await shelf.putStream('abcd1234', 'original.pdf', streamOf('12345', '67890'), 8)).toEqual({ ok: false, reason: 'too-large' });
		expect(await shelf.files('abcd1234')).toEqual([]);
	});
});

describe('stream', () => {
	it('answers a byte range, clamped to the file', async () => {
		await shelf.write('abcd1234', 'f.txt', '0123456789');
		const part = await shelf.stream('abcd1234', 'f.txt', { start: 2, end: 4 });
		expect(part && { size: part.size, start: part.start, end: part.end }).toEqual({ size: 10, start: 2, end: 4 });
		expect(await text(part!.body)).toBe('234');
		const tail = await shelf.stream('abcd1234', 'f.txt', { start: 7, end: 99 });
		expect(await text(tail!.body)).toBe('789');
	});

	it('is null for a missing file and for a start past the end', async () => {
		await shelf.write('abcd1234', 'f.txt', 'abc');
		expect(await shelf.stream('abcd1234', 'nope.txt')).toBeNull();
		expect(await shelf.stream('abcd1234', 'f.txt', { start: 3 })).toBeNull();
	});
});

describe('files, size, ids and remove', () => {
	it('lists a book and forgets it once removed', async () => {
		await shelf.write('abcd1234', 'book.json', '{}');
		await shelf.write('abcd1234', 'site/a/b.html', '<p>');
		expect(await shelf.files('abcd1234')).toEqual(['book.json', 'site/a/b.html']);
		expect(await shelf.size('abcd1234')).toBe(5);
		expect(await shelf.ids()).toEqual(['abcd1234']);
		await shelf.remove('abcd1234', 'site');
		expect(await shelf.files('abcd1234')).toEqual(['book.json']);
		await shelf.remove('abcd1234');
		await shelf.remove('abcd1234');
		expect(await shelf.ids()).toEqual([]);
		expect(await shelf.read('abcd1234', 'book.json')).toBeNull();
	});
});

describe('paths', () => {
	it.each([
		['abcd1234', '../escape'],
		['abcd1234', '/etc/passwd'],
		['abcd1234', 'site/../../x'],
		['../x', 'f'],
		['AB', 'f']
	])('refuses %s / %s', async (id, path) => {
		await expect(shelf.read(id, path)).rejects.toBeInstanceOf(ShelfPathError);
	});
});

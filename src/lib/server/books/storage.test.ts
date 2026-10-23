import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Shelf } from '../vault/shelf';
import { checkStorage, readStorage, writeStorage, MAX_STORAGE_BYTES } from './storage';
import { STORAGE } from './manifest';

describe('checkStorage', () => {
	const ok = (items: Record<string, string>) => ({ ok: true, items });
	const table: [string, unknown, unknown][] = [
		['items', { items: { a: '1', b: '' } }, ok({ a: '1', b: '' })],
		['empty items', { items: {} }, ok({})],
		['unicode', { items: { 'ключ': '日本語' } }, ok({ 'ключ': '日本語' })],
		['a number value', { items: { a: 1 } }, { ok: false, reason: 'invalid' }],
		['a null value', { items: { a: null } }, { ok: false, reason: 'invalid' }],
		['a nested value', { items: { a: { b: 'c' } } }, { ok: false, reason: 'invalid' }],
		['items as an array', { items: ['a'] }, { ok: false, reason: 'invalid' }],
		['no items', {}, { ok: false, reason: 'invalid' }],
		['null items', { items: null }, { ok: false, reason: 'invalid' }],
		['an array body', [], { ok: false, reason: 'invalid' }],
		['a string body', 'x', { ok: false, reason: 'invalid' }],
		['null body', null, { ok: false, reason: 'invalid' }]
	];
	for (const [name, body, expected] of table) it(name, () => expect(checkStorage(body)).toEqual(expected));

	it('refuses more than 2 MB and accepts just under', () => {
		expect(checkStorage({ items: { big: 'x'.repeat(MAX_STORAGE_BYTES) } })).toEqual({ ok: false, reason: 'too-large' });
		expect(checkStorage({ items: { big: 'x'.repeat(MAX_STORAGE_BYTES - 100) } })).toMatchObject({ ok: true });
	});

	it('counts bytes, not characters', () => {
		expect(checkStorage({ items: { k: '日'.repeat(MAX_STORAGE_BYTES / 3) } })).toEqual({ ok: false, reason: 'too-large' });
	});

	it('keeps a __proto__ key as data rather than changing the object', () => {
		const r = checkStorage(JSON.parse('{"items":{"__proto__":"x"}}'));
		expect(r).toMatchObject({ ok: true });
		expect(Object.keys((r as { items: object }).items)).toEqual(['__proto__']);
	});
});

describe('readStorage / writeStorage', () => {
	let root: string;
	let shelf: Shelf;
	const ID = 'abcdef0123456789';
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-storage-'));
		shelf = new Shelf(root);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('round-trips, replacing what was there', async () => {
		await writeStorage(shelf, ID, { a: '1', b: '2' });
		await writeStorage(shelf, ID, { a: '3' });
		expect(await readStorage(shelf, ID)).toEqual({ a: '3' });
	});

	it('reads {} for no file, bad JSON, and the wrong shape', async () => {
		expect(await readStorage(shelf, ID)).toEqual({});
		await shelf.write(ID, STORAGE, '{not json');
		expect(await readStorage(shelf, ID)).toEqual({});
		await shelf.write(ID, STORAGE, '["a"]');
		expect(await readStorage(shelf, ID)).toEqual({});
		await shelf.write(ID, STORAGE, '{"a":1}');
		expect(await readStorage(shelf, ID)).toEqual({});
	});
});

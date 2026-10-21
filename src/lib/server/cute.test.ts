import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Vault } from './vault/index';
import { characterName, characters, fileImage, imageFile, mediaOf, sniff, stamp, withLine } from './cute';

const png = async (w = 8, h = 8) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#e6a' } }).png().toBuffer());
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b]);

describe('sniff', () => {
	it('knows the four image types by their first bytes, and nothing else', async () => {
		expect(sniff(await png())).toBe('png');
		expect(sniff(GIF)).toBe('gif');
		expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniff(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]))).toBe('webp');
		expect(sniff(new TextEncoder().encode('<svg>'))).toBeNull();
		expect(sniff(new Uint8Array())).toBeNull();
	});
});

describe('mediaOf', () => {
	it('reads the note as it is in the vault: embeds side by side, and half-broken Reddit links', () => {
		const note = [
			'![[Pasted image 20260911002310.png]]![[Pasted image 20260911002539.png]]',
			'[![Now it’s turn for Yaku Neko appreciation! : r/ChainsmokerCat](https://i.redd.it/gnzt3w58o3ih1.jpg)',
			'![[notes.pdf]] ![[Other note]] ![[gif.GIF|200]]'
		].join('\n');
		expect(mediaOf(note)).toEqual([
			{ kind: 'file', name: 'Pasted image 20260911002310.png' },
			{ kind: 'file', name: 'Pasted image 20260911002539.png' },
			{ kind: 'url', url: 'https://i.redd.it/gnzt3w58o3ih1.jpg' },
			{ kind: 'file', name: 'gif.GIF' }
		]);
	});
});

describe('names and lines', () => {
	it('makes a typed name a file name, or refuses it', () => {
		expect(characterName('  Yaku   Neko ')).toBe('Yaku Neko');
		expect(characterName('a/b: c?')).toBe('a b c');
		expect(characterName('../')).toBeNull();
		expect(characterName('***')).toBeNull();
	});

	it('stamps local time', () => {
		expect(stamp(new Date(2026, 9, 21, 14, 3, 9))).toBe('20261021-140309');
	});

	it('adds a line at the end and keeps every byte before it', () => {
		expect(withLine('', 'x')).toBe('x\n');
		expect(withLine('a', 'x')).toBe('a\nx\n');
		expect(withLine('a\n', 'x')).toBe('a\nx\n');
	});
});

describe('filing an image', () => {
	let root: string;
	let vault: Vault;
	const NOW = new Date(2026, 9, 21, 14, 30, 0);
	const NOTE = '![[Pasted image 20260911002310.png]]![[Pasted image 20260911002539.png]]\n[![x](https://i.redd.it/a.jpg)';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-cute-'));
		vault = new Vault(root);
		await mkdir(join(root, 'Cute/images'), { recursive: true });
		await writeFile(join(root, 'Cute/Yaku Neko.md'), NOTE);
	});
	afterEach(() => rm(root, { recursive: true, force: true }));

	it('converts a screenshot to WebP and appends one embed, keeping the note’s own bytes', async () => {
		const filed = await fileImage(vault, await png(), 'yaku-neko', NOW);
		expect(filed).toEqual({ ok: true, character: 'Yaku Neko', slug: 'yaku-neko', file: 'Yaku Neko 20261021-143000.webp', type: 'webp' });
		expect(await readFile(join(root, 'Cute/Yaku Neko.md'), 'utf8')).toBe(`${NOTE}\n![[Yaku Neko 20261021-143000.webp]]\n`);
		expect(sniff(await readFile(join(root, 'Cute/images/Yaku Neko 20261021-143000.webp')))).toBe('webp');
	});

	it('keeps a GIF byte for byte', async () => {
		const filed = await fileImage(vault, GIF, 'yaku-neko', NOW);
		expect(filed).toMatchObject({ ok: true, file: 'Yaku Neko 20261021-143000.gif', type: 'gif' });
		expect(new Uint8Array(await readFile(join(root, 'Cute/images/Yaku Neko 20261021-143000.gif')))).toEqual(GIF);
	});

	it('names a second image in the same second apart, and lists newest first', async () => {
		await fileImage(vault, GIF, 'yaku-neko', NOW);
		await fileImage(vault, GIF, 'yaku-neko', NOW);
		expect((await readdir(join(root, 'Cute/images'))).sort()).toEqual(['Yaku Neko 20261021-143000 2.gif', 'Yaku Neko 20261021-143000.gif']);
		const [yaku] = await characters(vault);
		expect(yaku.media.slice(0, 2)).toEqual([
			{ kind: 'file', name: 'Yaku Neko 20261021-143000 2.gif' },
			{ kind: 'file', name: 'Yaku Neko 20261021-143000.gif' }
		]);
	});

	it('creates a new character’s note, and refuses a name another has, ignoring case', async () => {
		expect(await fileImage(vault, GIF, { create: 'Pusheen' }, NOW)).toMatchObject({ ok: true, character: 'Pusheen', slug: 'pusheen' });
		expect(await readFile(join(root, 'Cute/Pusheen.md'), 'utf8')).toBe('![[Pusheen 20261021-143000.gif]]\n');
		expect(await fileImage(vault, GIF, { create: 'yaku neko' }, NOW)).toMatchObject({ ok: false, reason: 'exists' });
		expect(await fileImage(vault, GIF, { create: '///' }, NOW)).toMatchObject({ ok: false, reason: 'no-name' });
	});

	it('refuses a file that is not an image, or a character not there, writing nothing', async () => {
		expect(await fileImage(vault, new TextEncoder().encode('hello'), 'yaku-neko', NOW)).toMatchObject({ ok: false, reason: 'bad-type' });
		expect(await fileImage(vault, GIF, 'nobody', NOW)).toMatchObject({ ok: false, reason: 'not-found' });
		expect(await readdir(join(root, 'Cute/images'))).toEqual([]);
		expect(await readFile(join(root, 'Cute/Yaku Neko.md'), 'utf8')).toBe(NOTE);
	});

	it('serves only an image directly in Cute/images', async () => {
		await fileImage(vault, GIF, 'yaku-neko', NOW);
		expect(await imageFile(vault, 'Yaku Neko 20261021-143000.gif')).toMatchObject({ type: 'gif' });
		await writeFile(join(root, 'Cute/images/fake.png'), 'not an image');
		expect(await imageFile(vault, 'fake.png')).toBeNull();
		expect(await imageFile(vault, '../Yaku Neko.md')).toBeNull();
		expect(await imageFile(vault, 'Yaku Neko.md')).toBeNull();
	});
});

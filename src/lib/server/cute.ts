/**
 * Cute: images of characters, one note per character.
 *
 * A character is a markdown file directly in `Cute/`, and its images are the
 * images its note shows, in the order written:
 *
 *     Cute/Yaku Neko.md
 *         ![[Pasted image 20260911002310.png]]
 *         ![[Yaku Neko 20261021-143000.webp]]
 *         ![a photo](https://i.redd.it/…jpg)
 *
 * Files filed from the tab live in `Cute/images/` as `<Name> <stamp>.<ext>`.
 * PNG and JPEG screenshots are converted to WebP first, much smaller in the
 * vault's git history; GIF and WebP are kept byte for byte. Filing appends one
 * embed line to the note and never touches a line already there.
 *
 * This module owns where Cute lives, which files are images and what a
 * character's name may be. The routes ask it; it reads and writes through the
 * vault only.
 */

import sharp from 'sharp';
import { slugify } from '$lib/shared/slug';
import { rewrite, type Written } from './rewrite';
import type { Vault } from './vault/index';

export const CUTE_FOLDER = 'Cute';
export const IMAGE_FOLDER = `${CUTE_FOLDER}/images`;

/** The largest file the tab files, before conversion. */
export const MAX_BYTES = 25 * 1024 * 1024;

/** WebP quality for a converted screenshot: no visible loss on text or line art. */
const WEBP_QUALITY = 85;

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';

const CONTENT_TYPES: Record<ImageType, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

/** The MIME type of an image type. Pure. */
export function contentType(type: ImageType): string {
	return CONTENT_TYPES[type];
}

/** What the first bytes say a file is, or null for anything but the four images taken. Pure. */
export function sniff(bytes: Uint8Array): ImageType | null {
	const at = (i: number, ...want: number[]) => want.every((b, j) => bytes[i + j] === b);
	if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
	if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
	return null;
}

/** One image a note shows: a file in the vault, by name, or a picture on the web. */
export type Media = { kind: 'file'; name: string } | { kind: 'url'; url: string };

const EMBED = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Every image `content` shows, in the order written: `![[file.png]]` embeds
 * of image files, and `![alt](https://…)` pictures. A link to anything else
 * is not an image and is left out. Pure.
 */
export function mediaOf(content: string): Media[] {
	const out: Media[] = [];
	for (const m of content.matchAll(EMBED)) {
		if (m[1] !== undefined) {
			const name = m[1].trim().split('/').pop()!;
			if (IMAGE_NAME.test(name)) out.push({ kind: 'file', name });
		} else out.push({ kind: 'url', url: m[2] });
	}
	return out;
}

/** A character as the tab shows it. */
export interface Character {
	name: string;
	/** Unique among the characters: `/cute/<slug>`. */
	slug: string;
	path: string;
	/** Newest first: the last written is the most recently filed. */
	media: Media[];
	mtimeMs: number;
}

/**
 * Every character, the one changed most recently first. Reads each note in
 * `Cute/`, not its subfolders. Never writes; a vault with no `Cute/` has none.
 */
export async function characters(vault: Vault): Promise<Character[]> {
	const paths = (await vault.list()).filter((p) => p.startsWith(`${CUTE_FOLDER}/`) && !p.slice(CUTE_FOLDER.length + 1).includes('/'));
	const out: Character[] = [];
	const taken = new Set<string>();
	for (const path of paths.sort()) {
		const note = await vault.read(path);
		if (!note.exists) continue;
		const name = path.slice(CUTE_FOLDER.length + 1).replace(/\.md$/, '');
		const base = slugify(name) || 'character';
		let slug = base;
		for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
		taken.add(slug);
		out.push({ name, slug, path, media: mediaOf(note.content).reverse(), mtimeMs: note.mtimeMs });
	}
	return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * A new character's name as typed, made into one a file can carry: no path
 * separators, nothing Obsidian refuses in a file name or a wikilink reads, no
 * leading or trailing dot, spaces collapsed. Null when nothing is left. Pure.
 */
export function characterName(typed: string): string | null {
	const name = typed.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim();
	return name && slugify(name) ? name : null;
}

/** `<YYYYMMDD-HHMMSS>` in local time, for a file name. Pure. */
export function stamp(at: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

/** `content` with `line` added as its own last line, every existing byte kept. Pure. */
export function withLine(content: string, line: string): string {
	if (!content) return `${line}\n`;
	return `${content}${content.endsWith('\n') ? '' : '\n'}${line}\n`;
}

type Filed = { ok: true; character: string; slug: string; file: string; type: ImageType } | { ok: false; reason: string; message: string };

const no = (reason: string, message: string): Filed => ({ ok: false, reason, message });

/**
 * File one image to a character: `to` is an existing character's slug, or
 * `{ create: name }` for a new one.
 *
 * Refuses, writing nothing, a file that is not a PNG, JPEG, GIF or WebP by
 * its bytes (`bad-type`), one over `MAX_BYTES` (`too-large`), a slug that
 * names no character (`not-found`), a new name that makes no file name
 * (`no-name`) or that a character already has, ignoring case (`exists`).
 *
 * Otherwise converts a PNG or JPEG to WebP, writes it to `Cute/images/` under
 * a name no file has yet, then appends its embed to the character's note,
 * creating the note for a new character. A clash on the note is retried; if
 * it still fails the image stays in `Cute/images/` and the answer says so.
 */
export async function fileImage(vault: Vault, bytes: Uint8Array, to: string | { create: string }, now: Date): Promise<Filed> {
	const type = sniff(bytes);
	if (!type) return no('bad-type', 'That is not a PNG, JPEG, GIF or WebP image.');
	if (bytes.length > MAX_BYTES) return no('too-large', `That image is over ${MAX_BYTES / 1024 / 1024} MB.`);

	const all = await characters(vault);
	let name: string;
	let path: string;
	if (typeof to === 'string') {
		const found = all.find((c) => c.slug === to);
		if (!found) return no('not-found', 'That character is not there any more.');
		({ name, path } = found);
	} else {
		const clean = characterName(to.create);
		if (!clean) return no('no-name', 'A character needs a name with a letter or digit in it.');
		if (all.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return no('exists', `There is already a character called ${clean}.`);
		name = clean;
		path = `${CUTE_FOLDER}/${clean}.md`;
	}

	const converted = type === 'png' || type === 'jpeg';
	const out = converted ? new Uint8Array(await sharp(bytes).webp({ quality: WEBP_QUALITY }).toBuffer()) : bytes;
	const ext = converted ? 'webp' : type;
	const base = `${name} ${stamp(now)}`;
	let file = `${base}.${ext}`;
	for (let n = 2; !(await vault.writeBytes(`${IMAGE_FOLDER}/${file}`, out)).ok; n++) file = `${base} ${n}.${ext}`;

	const written: Written = await rewrite(vault, path, (content) => withLine(content, `![[${file}]]`), 3, { create: typeof to !== 'string' });
	if (!written.ok) return no('conflict', `The image is saved as ${IMAGE_FOLDER}/${file}, but ${name}'s note changed meanwhile. Add it there by hand.`);
	const slug = typeof to === 'string' ? to : ((await characters(vault)).find((c) => c.path === path)?.slug ?? slugify(name));
	return { ok: true, character: name, slug, file, type: converted ? 'webp' : type };
}

/**
 * The bytes and type of the image file `name` directly in `Cute/images/`, or
 * null: for a name with a path in it, one that is not an image by its bytes,
 * or none at all. The only door the Cute routes have to the vault's files.
 */
export async function imageFile(vault: Vault, name: string): Promise<{ bytes: Uint8Array; type: ImageType } | null> {
	if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.') || !IMAGE_NAME.test(name)) return null;
	const bytes = await vault.readBytes(`${IMAGE_FOLDER}/${name}`);
	const type = bytes ? sniff(bytes) : null;
	return bytes && type ? { bytes, type } : null;
}

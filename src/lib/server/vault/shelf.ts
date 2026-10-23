/**
 * The shelf: where books' own files live, outside the vault and out of git.
 *
 * This is the vault module's second store, here because filesystem access
 * lives only in `vault/`. It knows nothing about PDFs, EPUBs or notes. It
 * holds one folder per book id, and inside it any files the books module
 * names, by paths relative to that folder (`book.json`, `original.pdf`,
 * `site/ch01.html`). The layout inside a folder is the books module's
 * business; see `server/books/`.
 *
 * Like the vault, it defines its errors away where it can: a missing file
 * reads as null, a missing book lists as nothing, and removing a book that
 * is not there is done. What it refuses, it answers as a reason, never a
 * throw. The one throw is `ShelfPathError`, for a path that would leave the
 * book's folder, because that is a bug in the caller.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config';

export class ShelfPathError extends Error {
	constructor(path: string) {
		super(`Path is not inside a book's folder: ${path}`);
		this.name = 'ShelfPathError';
	}
}

/** A book id: lowercase hex or digits and dashes, as `books/id.ts` makes them. */
const ID = /^[a-z0-9][a-z0-9-]{3,63}$/;

/** What `stream` answers: the bytes asked for, and enough to write a 200 or a 206. */
export interface ShelfStream {
	body: ReadableStream<Uint8Array>;
	/** The whole file's size. */
	size: number;
	/** The first and last byte sent, inclusive. The whole file is `0` to `size - 1`. */
	start: number;
	end: number;
	mtimeMs: number;
}

export class Shelf {
	constructor(private readonly root: string = config.books.path) {}

	/**
	 * Write a file into a book's folder from a stream, without holding it in
	 * memory, and hash it on the way. Writes to a temporary name and renames
	 * it into place only once every byte has arrived, so a half-sent upload
	 * never shows as a file. Replaces a file already at that path.
	 *
	 * Refuses `too-large` once more than `maxBytes` have arrived, and
	 * `no-space` when the disk has less than `config.books.keepFreeBytes`
	 * free before it starts; either way nothing is left behind. Answers the
	 * byte count and the sha256 of the bytes, in hex.
	 */
	async putStream(
		id: string,
		path: string,
		body: ReadableStream<Uint8Array>,
		maxBytes: number = config.books.maxBytes
	): Promise<{ ok: true; bytes: number; sha256: string } | { ok: false; reason: 'too-large' | 'no-space' }> {
		const target = this.at(id, path);
		if ((await this.free()) < config.books.keepFreeBytes) return { ok: false, reason: 'no-space' };
		await mkdir(dirname(target), { recursive: true });
		const temp = `${target}.part-${randomBytes(4).toString('hex')}`;
		const hash = createHash('sha256');
		let bytes = 0;
		let over = false;
		const count = new Transform({
			transform(chunk: Buffer, _enc, done) {
				bytes += chunk.length;
				if (bytes > maxBytes) {
					over = true;
					done(new Error('too-large'));
					return;
				}
				hash.update(chunk);
				done(null, chunk);
			}
		});
		try {
			await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), count, createWriteStream(temp));
		} catch (e) {
			await rm(temp, { force: true });
			if (over) return { ok: false, reason: 'too-large' };
			throw e;
		}
		await rename(temp, target);
		return { ok: true, bytes, sha256: hash.digest('hex') };
	}

	/** Write a whole file into a book's folder, creating folders as needed and replacing what was there. */
	async write(id: string, path: string, content: Uint8Array | string): Promise<void> {
		const target = this.at(id, path);
		await mkdir(dirname(target), { recursive: true });
		const temp = `${target}.part-${randomBytes(4).toString('hex')}`;
		await writeFile(temp, content);
		await rename(temp, target);
	}

	/** A file's bytes, or null when it is not there. Never throws for a missing file. */
	async read(id: string, path: string): Promise<Uint8Array | null> {
		try {
			return new Uint8Array(await readFile(this.at(id, path)));
		} catch (e) {
			if (e instanceof ShelfPathError) throw e;
			return null;
		}
	}

	/** A file as text (UTF-8), or null when it is not there. */
	async readText(id: string, path: string): Promise<string | null> {
		const bytes = await this.read(id, path);
		return bytes ? new TextDecoder().decode(bytes) : null;
	}

	/**
	 * Stream a file, or the byte range `start` to `end` (inclusive) of it, for
	 * an HTTP range request. A range is clamped to the file; an `end` left out
	 * means to the end. Null when the file is not there, or when `start` is
	 * past its end, which a route answers as 416.
	 */
	async stream(id: string, path: string, range?: { start: number; end?: number }): Promise<ShelfStream | null> {
		const target = this.at(id, path);
		const info = await stat(target).catch(() => null);
		if (!info?.isFile()) return null;
		const size = info.size;
		const start = Math.max(0, range?.start ?? 0);
		const end = Math.min(size - 1, range?.end ?? size - 1);
		if (size > 0 && start > end) return null;
		const node = size === 0 ? Readable.from([]) : createReadStream(target, { start, end });
		return { body: Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>, size, start, end: Math.max(end, start - 1), mtimeMs: info.mtimeMs };
	}

	/** A file's size and modification time, or null when it is not there (or is a folder). */
	async info(id: string, path: string): Promise<{ size: number; mtimeMs: number } | null> {
		const found = await stat(this.at(id, path)).catch(() => null);
		return found?.isFile() ? { size: found.size, mtimeMs: found.mtimeMs } : null;
	}

	/** Every file in a book's folder, relative to it and sorted. Empty for a book that is not there. */
	async files(id: string): Promise<string[]> {
		const base = this.at(id, '');
		const out: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
				const absolute = join(dir, entry.name);
				if (entry.isDirectory()) await walk(absolute);
				else if (entry.isFile() && !entry.name.includes('.part-')) out.push(relative(base, absolute).split(sep).join('/'));
			}
		};
		await walk(base);
		return out.sort();
	}

	/** How many bytes a book's folder holds, every file counted. 0 for a book that is not there. */
	async size(id: string): Promise<number> {
		let total = 0;
		for (const file of await this.files(id)) total += (await stat(this.at(id, file)).catch(() => null))?.size ?? 0;
		return total;
	}

	/** Every book id on the shelf, sorted. */
	async ids(): Promise<string[]> {
		const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
		return entries.filter((e) => e.isDirectory() && ID.test(e.name)).map((e) => e.name).sort();
	}

	/**
	 * Remove a book's whole folder, or one folder inside it when `path` is
	 * given (a saved site being replaced). Removing what is not there is done.
	 */
	async remove(id: string, path = ''): Promise<void> {
		await rm(this.at(id, path), { recursive: true, force: true });
	}

	/**
	 * Move a whole book folder to a new id: an upload is streamed in under a
	 * temporary id, because its real id is the hash of bytes not yet seen.
	 * Whatever was at `to` is replaced. Answers false when `from` is not there.
	 */
	async rename(from: string, to: string): Promise<boolean> {
		const source = this.at(from, '');
		if (!(await stat(source).catch(() => null))?.isDirectory()) return false;
		const target = this.at(to, '');
		await rm(target, { recursive: true, force: true });
		await rename(source, target);
		return true;
	}

	/**
	 * Move a file or folder inside one book's folder, replacing whatever was
	 * at `to`: a site saved into `html.new/` takes `html/`'s place only once
	 * it is complete. Answers false when `from` is not there.
	 */
	async move(id: string, from: string, to: string): Promise<boolean> {
		const source = this.at(id, from);
		if (!(await stat(source).catch(() => null))) return false;
		const target = this.at(id, to);
		await rm(target, { recursive: true, force: true });
		await mkdir(dirname(target), { recursive: true });
		await rename(source, target);
		return true;
	}

	/** Bytes free on the disk the shelf is on. */
	async free(): Promise<number> {
		await mkdir(this.root, { recursive: true });
		const fs = await statfs(this.root);
		return Number(fs.bavail) * Number(fs.bsize);
	}

	/** The absolute path of `path` in book `id`'s folder; throws `ShelfPathError` for one that would leave it. */
	private at(id: string, path: string): string {
		if (!ID.test(id)) throw new ShelfPathError(`${id}/${path}`);
		if (isAbsolute(path) || path.includes('\0')) throw new ShelfPathError(`${id}/${path}`);
		const base = join(this.root, id);
		const absolute = normalize(join(base, path));
		const rel = relative(base, absolute);
		if (rel.startsWith('..') || isAbsolute(rel)) throw new ShelfPathError(`${id}/${path}`);
		return absolute;
	}
}

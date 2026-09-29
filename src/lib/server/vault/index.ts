/**
 * The vault: reading, writing and watching the markdown files that are the
 * hub's only source of truth.
 *
 * This module owns every filesystem call, every absolute path, the content
 * hashes used for conflict detection, and the sync provider. Nothing above it
 * knows the vault is a directory on disk, let alone a git repository.
 *
 * The private folder is a second vault inside the first. Every method takes
 * a scope, `public` by default: in public scope a private path reads as
 * missing, lists and trees leave the folder out, and the watcher never
 * reports it. In private scope only private paths are visible. So a caller
 * that forgets the scope sees less, never more.
 *
 * Two deliberate absences of error:
 *  - Reading a note that does not exist returns an empty note with
 *    `exists: false`, because opening tomorrow's daily note is normal.
 *  - Writing never throws on a conflict; it returns one, so the caller can
 *    show a merge rather than catch an exception.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { config } from '../config';
import { isIgnored, isMarkdown, isPrivate, toAbsolute, toRelative } from './paths';
import { noSync, type SyncProvider } from './sync';

export interface Note {
	/** Vault-relative path, e.g. `Journal/2026/09/21.md`. */
	path: string;
	content: string;
	/** Short content hash; pass it back to `write` to detect a clashing edit. */
	hash: string;
	mtimeMs: number;
	/** False when the file is not on disk; `content` is then empty. */
	exists: boolean;
}

export type WriteResult =
	| { ok: true; note: Note }
	| { ok: false; reason: 'conflict'; current: Note; yourContent: string };

export type RemoveResult =
	| { ok: true }
	/** Nothing was there to remove. */
	| { ok: false; reason: 'missing' }
	/** The note changed since `expectedHash` was read; it is still there. */
	| { ok: false; reason: 'conflict'; current: Note };

export interface FileChange {
	path: string;
	kind: 'added' | 'changed' | 'removed';
	/** True when the hub itself made the change, so listeners can skip echoes. */
	self: boolean;
}

export type TreeNode =
	| { type: 'folder'; name: string; path: string; children: TreeNode[] }
	| { type: 'note'; name: string; path: string };

/** Which side of the private folder a call may see. */
export type Scope = 'public' | 'private';

export interface ScopeOption {
	/** Absent means public. */
	scope?: Scope;
}

/** Thrown when a write names a path outside the scope it asked for. */
export class ScopeError extends Error {
	constructor(path: string) {
		super(`Path is outside this scope: ${path}`);
		this.name = 'ScopeError';
	}
}

const inScope = (path: string, scope: Scope = 'public') => isPrivate(path) === (scope === 'private');

export function hashContent(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

export class Vault {
	private listeners = new Set<(change: FileChange) => void>();
	private watcher: FSWatcher | null = null;
	/** Paths this process just wrote, so the watcher can label its own echo. */
	private ownWrites = new Map<string, number>();

	constructor(
		private readonly root: string = config.vaultPath,
		readonly sync: SyncProvider = noSync
	) {}

	/**
	 * Read a note. A missing file is an empty note, not an error, and so is a
	 * file outside the requested scope: to a public caller the private folder
	 * does not exist.
	 */
	async read(path: string, opts: ScopeOption = {}): Promise<Note> {
		const absolute = toAbsolute(path, this.root);
		if (!inScope(path, opts.scope)) return { path, content: '', hash: hashContent(''), mtimeMs: 0, exists: false };
		try {
			const [content, info] = await Promise.all([readFile(absolute, 'utf8'), stat(absolute)]);
			return { path, content, hash: hashContent(content), mtimeMs: info.mtimeMs, exists: true };
		} catch {
			return { path, content: '', hash: hashContent(''), mtimeMs: 0, exists: false };
		}
	}

	/**
	 * Write a note, creating parent folders as needed.
	 *
	 * When `expectedHash` is given and the file on disk no longer matches it,
	 * nothing is written and the current note is returned alongside the text
	 * the caller wanted to save, which is everything a merge view needs.
	 *
	 * Throws `ScopeError` for a path outside the requested scope, because that
	 * is a bug in the caller, not a state of the vault. A private write is
	 * never marked for sync and never announced to subscribers.
	 */
	async write(path: string, content: string, expectedHash?: string, opts: ScopeOption = {}): Promise<WriteResult> {
		if (!inScope(path, opts.scope)) throw new ScopeError(path);
		const current = await this.read(path, opts);
		if (expectedHash !== undefined && current.exists && current.hash !== expectedHash) {
			return { ok: false, reason: 'conflict', current, yourContent: content };
		}

		const absolute = toAbsolute(path, this.root);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, content, 'utf8');
		this.ownWrites.set(path, Date.now());

		const info = await stat(absolute);
		const note: Note = { path, content, hash: hashContent(content), mtimeMs: info.mtimeMs, exists: true };
		if (opts.scope === 'private') return { ok: true, note };
		this.sync.markDirty(path);
		this.emit({ path, kind: current.exists ? 'changed' : 'added', self: true });
		return { ok: true, note };
	}

	/**
	 * Delete one note.
	 *
	 * The one removal the vault offers, for the rare file a user asks to be
	 * rid of (a workspace definition). Guarded like `write`: with
	 * `expectedHash`, a note that has changed since is left alone and returned.
	 * Marked for sync like a write, so the deletion is committed and the note
	 * stays recoverable from git history; announced to subscribers, so the
	 * index forgets it. Throws `ScopeError` outside the requested scope, and
	 * never removes a folder or anything but the one file named.
	 */
	async remove(path: string, expectedHash?: string, opts: ScopeOption = {}): Promise<RemoveResult> {
		if (!inScope(path, opts.scope)) throw new ScopeError(path);
		const current = await this.read(path, opts);
		if (!current.exists) return { ok: false, reason: 'missing' };
		if (expectedHash !== undefined && current.hash !== expectedHash) return { ok: false, reason: 'conflict', current };

		await rm(toAbsolute(path, this.root));
		this.ownWrites.set(path, Date.now());
		if (opts.scope === 'private') return { ok: true };
		this.sync.markDirty(path);
		this.emit({ path, kind: 'removed', self: true });
		return { ok: true };
	}

	/** Every markdown file in the scope, vault-relative, sorted. */
	async list(opts: ScopeOption = {}): Promise<string[]> {
		const out: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) {
				const absolute = `${dir}/${entry.name}`;
				const relative = toRelative(absolute, this.root);
				if (isIgnored(relative)) continue;
				if (entry.isDirectory()) {
					if (opts.scope !== 'private' && isPrivate(relative)) continue;
					await walk(absolute);
				} else if (isMarkdown(relative) && inScope(relative, opts.scope)) out.push(relative);
			}
		};
		await walk(opts.scope === 'private' ? toAbsolute(config.privateFolder, this.root) : this.root);
		return out.sort();
	}

	/**
	 * File names directly inside one folder whose name ends in `.` + `ext`,
	 * sorted. Public scope only: a workspace's custom pages are meant to be
	 * embedded read-only, which is a public feature, so there is no reason yet
	 * to let a private folder's non-markdown files through this door.
	 *
	 * Unlike `list`, this never recurses and never returns a markdown file —
	 * it exists for the handful of formats the vault holds beside markdown,
	 * such as a workspace's custom HTML pages, named by the caller rather than
	 * assumed. A folder that does not exist reads as empty, the same as an
	 * empty one, because "no pages yet" is not an error.
	 */
	async files(folder: string, ext: string): Promise<string[]> {
		if (isPrivate(folder)) return [];
		const suffix = `.${ext.replace(/^\.+/, '')}`;
		const absolute = toAbsolute(folder, this.root);
		const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(suffix) && !isIgnored(`${folder}/${entry.name}`))
			.map((entry) => entry.name)
			.sort();
	}

	/** The public file tree the notes viewer renders. Folders with no notes are omitted. */
	async tree(): Promise<TreeNode[]> {
		const paths = await this.list();
		const root: TreeNode[] = [];

		for (const path of paths) {
			const parts = path.split('/');
			let level = root;
			for (let i = 0; i < parts.length - 1; i++) {
				const name = parts[i];
				const folderPath = parts.slice(0, i + 1).join('/');
				let folder = level.find((n): n is Extract<TreeNode, { type: 'folder' }> => n.type === 'folder' && n.name === name);
				if (!folder) {
					folder = { type: 'folder', name, path: folderPath, children: [] };
					level.push(folder);
				}
				level = folder.children;
			}
			const name = parts[parts.length - 1];
			level.push({ type: 'note', name: name.slice(0, -3), path });
		}

		const sort = (nodes: TreeNode[]): TreeNode[] => {
			nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
			for (const n of nodes) if (n.type === 'folder') sort(n.children);
			return nodes;
		};
		return sort(root);
	}

	/** Subscribe to changes from any source. Returns an unsubscribe function. */
	subscribe(listener: (change: FileChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Begin watching the vault. Safe to call twice. */
	watch(): void {
		if (this.watcher) return;
		this.watcher = chokidar.watch(this.root, {
			ignoreInitial: true,
			ignored: (path: string) => {
				const relative = toRelative(path, this.root);
				return relative !== '' && (isIgnored(relative) || isPrivate(relative));
			}
		});
		const on = (kind: FileChange['kind']) => (absolute: string) => {
			const path = toRelative(absolute, this.root);
			if (!isMarkdown(path)) return;
			this.emit({ path, kind, self: this.wasOwnWrite(path) });
		};
		this.watcher.on('add', on('added')).on('change', on('changed')).on('unlink', on('removed'));
	}

	async close(): Promise<void> {
		await this.watcher?.close();
		this.watcher = null;
		await this.sync.stop();
	}

	private wasOwnWrite(path: string): boolean {
		const at = this.ownWrites.get(path);
		if (at === undefined) return false;
		// The watcher fires a moment after the write; anything later is the user.
		if (Date.now() - at > 2000) {
			this.ownWrites.delete(path);
			return false;
		}
		return true;
	}

	private emit(change: FileChange): void {
		for (const listener of this.listeners) {
			try {
				listener(change);
			} catch {
				// A broken listener must not stop the others or fail a save.
			}
		}
	}
}

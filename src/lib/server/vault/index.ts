/**
 * The vault: reading, writing and watching the markdown files that are the
 * hub's only source of truth.
 *
 * This module owns every filesystem call, every absolute path, the content
 * hashes used for conflict detection, and the sync provider. Nothing above it
 * knows the vault is a directory on disk, let alone a git repository.
 *
 * Two deliberate absences of error:
 *  - Reading a note that does not exist returns an empty note with
 *    `exists: false`, because opening tomorrow's daily note is normal.
 *  - Writing never throws on a conflict; it returns one, so the caller can
 *    show a merge rather than catch an exception.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { config } from '../config';
import { isIgnored, isMarkdown, toAbsolute, toRelative } from './paths';
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

export interface FileChange {
	path: string;
	kind: 'added' | 'changed' | 'removed';
	/** True when the hub itself made the change, so listeners can skip echoes. */
	self: boolean;
}

export type TreeNode =
	| { type: 'folder'; name: string; path: string; children: TreeNode[] }
	| { type: 'note'; name: string; path: string };

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

	/** Read a note. A missing file is an empty note, not an error. */
	async read(path: string): Promise<Note> {
		const absolute = toAbsolute(path, this.root);
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
	 */
	async write(path: string, content: string, expectedHash?: string): Promise<WriteResult> {
		const current = await this.read(path);
		if (expectedHash !== undefined && current.exists && current.hash !== expectedHash) {
			return { ok: false, reason: 'conflict', current, yourContent: content };
		}

		const absolute = toAbsolute(path, this.root);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, content, 'utf8');
		this.ownWrites.set(path, Date.now());

		const info = await stat(absolute);
		const note: Note = { path, content, hash: hashContent(content), mtimeMs: info.mtimeMs, exists: true };
		this.sync.markDirty(path);
		this.emit({ path, kind: current.exists ? 'changed' : 'added', self: true });
		return { ok: true, note };
	}

	/** Every markdown file in the vault, vault-relative, in directory order. */
	async list(): Promise<string[]> {
		const out: string[] = [];
		const walk = async (dir: string): Promise<void> => {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const absolute = `${dir}/${entry.name}`;
				const relative = toRelative(absolute, this.root);
				if (isIgnored(relative)) continue;
				if (entry.isDirectory()) await walk(absolute);
				else if (isMarkdown(relative)) out.push(relative);
			}
		};
		await walk(this.root);
		return out.sort();
	}

	/** The file tree the sidebar renders. Folders with no notes are omitted. */
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
				return relative !== '' && isIgnored(relative);
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

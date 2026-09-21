/**
 * Git implementation of SyncProvider.
 *
 * Shape of the loop:
 *  - A save marks the file dirty and returns immediately. Git never blocks an
 *    edit; if the network is down the user keeps working.
 *  - Some minutes after the last save, everything dirty becomes one commit and
 *    is pushed.
 *  - A pull runs on a timer and always before a commit.
 *
 * Every method resolves with a status rather than throwing. A sync layer that
 * throws into request handlers would make every caller defensive; instead the
 * failure is data, shown on the Sync page.
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../config';
import { toAbsolute } from './paths';
import type { ConflictDetail, DiscardResult, PendingFile, SyncProvider, SyncStatus } from './sync';

/**
 * Paths inside the hub folder that hold state rather than content. They are
 * written through the vault so they survive a restart, but they are never
 * committed and never pulled.
 */
const TRANSIENT = [`${config.hubFolder}/timer.json`, `${config.hubFolder}/.state/`];

export function isTransient(path: string): boolean {
	return TRANSIENT.some((t) => path === t || path.startsWith(t));
}

export class GitSync implements SyncProvider {
	private git: SimpleGit;
	private dirty = new Set<string>();
	private commitTimer: NodeJS.Timeout | null = null;
	private pullTimer: NodeJS.Timeout | null = null;
	private running: Promise<unknown> = Promise.resolve();
	private state = {
		conflicts: [] as string[],
		lastPull: null as Date | null,
		lastPush: null as Date | null,
		error: null as string | null,
		busy: false
	};

	constructor(private vaultPath: string = config.vaultPath) {
		this.git = simpleGit(vaultPath);
	}

	async status(): Promise<SyncStatus> {
		try {
			const s = await this.git.status();
			const pending = [...new Set([...s.not_added, ...s.modified, ...s.created, ...s.deleted, ...this.dirty])];
			return {
				...this.snapshot(),
				pending,
				conflicts: s.conflicted.length ? s.conflicted : this.state.conflicts,
				ahead: s.ahead,
				behind: s.behind
			};
		} catch (e) {
			this.state.error = message(e);
			return { ...this.snapshot(), pending: [...this.dirty] };
		}
	}

	/**
	 * Both versions of a file that would not merge: what is on this machine and
	 * what is on the remote.
	 *
	 * Read-only on purpose. Resolving a divergence means discarding somebody's
	 * work, so this shows the two texts and leaves the decision, and the
	 * command, to the user rather than offering a one-click destructive git
	 * operation.
	 */
	async conflictDetail(path: string): Promise<ConflictDetail | null> {
		try {
			const [mine, theirs] = await Promise.all([
				this.git.show([`HEAD:${path}`]).catch(() => ''),
				this.git.show([`origin/${config.git.branch}:${path}`]).catch(() => '')
			]);
			return { path, mine, theirs };
		} catch {
			return null;
		}
	}

	pull(): Promise<SyncStatus> {
		return this.serialise(async () => {
			await this.git.fetch();
			// Naming the remote and branch explicitly: a vault whose branch has
			// no upstream configured would otherwise fail with git's "no
			// tracking information" error, which is not the user's problem.
			const result = await this.git.pull('origin', config.git.branch, ['--rebase']);
			this.state.lastPull = new Date();
			this.state.conflicts = [];
			this.state.error = null;
			if (result.files.length) this.state.lastPull = new Date();
			return this.status();
		});
	}

	push(reason: string, paths: string[] = []): Promise<SyncStatus> {
		return this.serialise(async () => {
			const before = await this.git.status();
			if (before.isClean() && before.ahead === 0) {
				if (!paths.length) this.dirty.clear();
				return this.status();
			}
			await this.pullInline();
			if (this.state.conflicts.length) return this.status();

			// Stage only what this app wrote. `add -A` would sweep up changes the
			// user made in their editor and commit them under a message that
			// claims otherwise.
			const staged = paths.length ? paths : [...this.dirty];
			if (staged.length) {
				await this.git.add(['--', ...staged]);
				const diff = await this.git.diff(['--cached', '--name-only']);
				if (diff.trim()) await this.git.commit(reason);
			}
			// `-u` so a fresh clone gains tracking on first push.
			await this.git.push(['-u', 'origin', config.git.branch]);
			this.state.lastPush = new Date();
			this.state.error = null;
			if (paths.length) for (const path of paths) this.dirty.delete(path);
			else this.dirty.clear();
			return this.status();
		});
	}

	/** Local changes, labelled by whether this app or the editor made them. */
	async pending(): Promise<PendingFile[]> {
		try {
			const s = await this.git.status();
			const seen = new Map<string, PendingFile>();
			const add = (path: string, status: PendingFile['status']) => {
				if (!seen.has(path)) seen.set(path, { path, status, byApp: this.dirty.has(path) });
			};
			for (const path of s.deleted) add(path, 'deleted');
			for (const path of s.renamed.map((r) => r.to)) add(path, 'renamed');
			for (const path of s.created) add(path, 'added');
			for (const path of s.modified) add(path, 'modified');
			for (const path of s.not_added) add(path, 'untracked');
			return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
		} catch (e) {
			this.state.error = message(e);
			return [];
		}
	}

	/** Unified diff for one file. An untracked file is shown in full. */
	async diff(path: string): Promise<string> {
		try {
			const tracked = await this.git.raw(['ls-files', '--error-unmatch', '--', path]).then(
				() => true,
				() => false
			);
			if (tracked) {
				const out = await this.git.diff(['--', path]);
				return out || '(no textual change)';
			}
			const content = await this.git.raw(['--no-pager', 'diff', '--no-index', '/dev/null', path]).catch(() => '');
			return content || '(new file)';
		} catch (e) {
			return `Could not read a diff: ${message(e)}`;
		}
	}

	/** Commit and push exactly these paths. */
	async commit(paths: string[], subject: string): Promise<SyncStatus> {
		const safe = paths.filter((p) => this.isInsideVault(p));
		if (!safe.length) return this.status();
		return this.push(subject || commitSubject(safe), safe);
	}

	/**
	 * Throw away local changes to these paths.
	 *
	 * Copies each file to an undo directory first. Discarding is the one
	 * irreversible thing this module does, so it is made reversible.
	 */
	async discard(paths: string[]): Promise<DiscardResult> {
		const safe = paths.filter((p) => this.isInsideVault(p));
		if (!safe.length) return { discarded: [], snapshot: null, error: 'Nothing to discard' };

		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const snapshot = join(config.undoPath, `discard-${stamp}`);

		try {
			for (const path of safe) {
				const from = toAbsolute(path, this.vaultPath);
				const to = join(snapshot, path);
				await mkdir(dirname(to), { recursive: true });
				await copyFile(from, to).catch(() => {});
			}

			const status = await this.git.status();
			const untracked = new Set(status.not_added);
			const tracked = safe.filter((p) => !untracked.has(p));
			const fresh = safe.filter((p) => untracked.has(p));

			if (tracked.length) await this.git.checkout(['HEAD', '--', ...tracked]);
			for (const path of fresh) await rm(toAbsolute(path, this.vaultPath), { force: true });
			for (const path of safe) this.dirty.delete(path);

			return { discarded: safe, snapshot, error: null };
		} catch (e) {
			return { discarded: [], snapshot, error: message(e) };
		}
	}

	private isInsideVault(path: string): boolean {
		try {
			toAbsolute(path, this.vaultPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Note that the app wrote `path`, so the next commit includes it.
	 *
	 * Transient state is skipped. A running timer, for instance, is a file only
	 * because it has to survive a restart; committing it would put a stream of
	 * meaningless commits into the user's history and conflict on every device.
	 * It is not a source of truth, so losing it costs nothing.
	 */
	markDirty(path: string): void {
		if (isTransient(path)) return;
		this.dirty.add(path);
		this.scheduleCommit();
	}

	start(): void {
		if (this.pullTimer) return;
		this.pullTimer = setInterval(() => void this.pull().catch(() => {}), config.git.pullIntervalMs);
		this.pullTimer.unref?.();
		void this.pull().catch(() => {});
	}

	async stop(): Promise<void> {
		if (this.pullTimer) clearInterval(this.pullTimer);
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.pullTimer = this.commitTimer = null;
		if (this.dirty.size) await this.flush();
		await this.running;
	}

	/** Commit and push everything dirty now, ignoring the debounce. */
	flush(): Promise<SyncStatus> {
		const files = [...this.dirty];
		if (files.length === 0) return this.status();
		return this.push(commitSubject(files));
	}

	private scheduleCommit(): void {
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.commitTimer = setTimeout(() => {
			this.commitTimer = null;
			void this.flush().catch(() => {});
		}, config.git.commitDebounceMs);
		this.commitTimer.unref?.();
	}

	/** Pull inside an already-serialised operation. Records conflicts instead of throwing. */
	private async pullInline(): Promise<void> {
		try {
			await this.git.fetch();
			await this.git.pull('origin', config.git.branch, ['--rebase']);
			this.state.lastPull = new Date();
			this.state.conflicts = [];
		} catch (e) {
			const s = await this.git.status().catch(() => null);
			if (s?.conflicted.length) {
				this.state.conflicts = s.conflicted;
				await this.git.rebase(['--abort']).catch(() => {});
			}
			this.state.error = message(e);
		}
	}

	/** Run git operations one at a time; concurrent pull and push corrupt each other. */
	private serialise(work: () => Promise<SyncStatus>): Promise<SyncStatus> {
		const next = this.running.then(async () => {
			this.state.busy = true;
			try {
				return await work();
			} catch (e) {
				this.state.error = message(e);
				return { ...this.snapshot(), pending: [...this.dirty] };
			} finally {
				this.state.busy = false;
			}
		});
		this.running = next.catch(() => {});
		return next;
	}

	private snapshot(): SyncStatus {
		return {
			provider: 'git',
			pending: [],
			conflicts: this.state.conflicts,
			lastPull: this.state.lastPull,
			lastPush: this.state.lastPush,
			error: this.state.error,
			busy: this.state.busy,
			ahead: 0,
			behind: 0
		};
	}
}

/** `hub: 3 files (21.md, QMS.md, ...)` — recognisable in a log of hand-written commits. */
export function commitSubject(files: string[]): string {
	const names = files.map((f) => f.split('/').pop() ?? f);
	const shown = names.slice(0, 3).join(', ');
	const more = names.length > 3 ? `, +${names.length - 3} more` : '';
	return `hub: ${files.length} file${files.length === 1 ? '' : 's'} (${shown}${more})`;
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

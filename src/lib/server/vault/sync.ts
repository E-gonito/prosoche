/**
 * What the hub needs from whatever keeps the vault in step with the user's
 * other devices.
 *
 * Today that is git. It was Syncthing in an earlier draft and could be again.
 * Keeping the rest of the app behind this interface is what makes that a
 * configuration change rather than a rewrite: nothing outside the vault module
 * knows a commit exists.
 */

export interface SyncStatus {
	/** Human-readable provider name, shown on the Sync page. */
	provider: string;
	/** Files changed locally and not yet sent to the remote. */
	pending: string[];
	/** Files the provider could not merge and needs a human for. */
	conflicts: string[];
	lastPull: Date | null;
	lastPush: Date | null;
	/** Last error, cleared by the next success. Never thrown at the caller. */
	error: string | null;
	/** True while a pull or push is in flight. */
	busy: boolean;
	/** Local commits the remote does not have. */
	ahead: number;
	/** Remote commits not yet integrated locally. */
	behind: number;
}

/** Both sides of a file the provider could not merge. */
export interface ConflictDetail {
	path: string;
	mine: string;
	theirs: string;
}

/** A local change not yet sent to the remote. */
export interface PendingFile {
	path: string;
	status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';
	/** True when this app wrote the file, rather than the user's editor. */
	byApp: boolean;
}

/** Result of a discard, naming where the snapshot went. */
export interface DiscardResult {
	discarded: string[];
	/** Directory holding copies of what was thrown away. */
	snapshot: string | null;
	error: string | null;
}

export interface SyncProvider {
	/** Current state. Always resolves; failures surface as `error`. */
	status(): Promise<SyncStatus>;
	/** Fetch and integrate remote changes. */
	pull(): Promise<SyncStatus>;
	/** Record local changes and send them. `reason` becomes the commit subject. */
	push(reason: string): Promise<SyncStatus>;
	/** Note that a file changed, so the provider can batch a push later. */
	markDirty(path: string): void;
	/** Begin scheduled work. Idempotent. */
	start(): void;
	/** Stop scheduled work and flush anything pending. */
	stop(): Promise<void>;
	/** Both versions of a conflicted file, for a side-by-side view. */
	conflictDetail(path: string): Promise<ConflictDetail | null>;
	/** Local changes, with enough detail to choose between them. */
	pending(): Promise<PendingFile[]>;
	/** Unified diff for one pending file, for review before committing. */
	diff(path: string): Promise<string>;
	/** Commit and push exactly these paths, leaving everything else alone. */
	commit(paths: string[], message: string): Promise<SyncStatus>;
	/** Throw away local changes to these paths, after snapshotting them. */
	discard(paths: string[]): Promise<DiscardResult>;
}

/** Used when no provider is configured, so callers never branch on null. */
export const noSync: SyncProvider = {
	async status() {
		return {
			provider: 'none',
			pending: [],
			conflicts: [],
			lastPull: null,
			lastPush: null,
			error: null,
			busy: false,
			ahead: 0,
			behind: 0
		};
	},
	async pull() {
		return this.status();
	},
	async push() {
		return this.status();
	},
	markDirty() {},
	start() {},
	async stop() {},
	async conflictDetail() {
		return null;
	},
	async pending() {
		return [];
	},
	async diff() {
		return '';
	},
	async commit() {
		return this.status();
	},
	async discard() {
		return { discarded: [], snapshot: null, error: 'No sync provider configured' };
	}
};

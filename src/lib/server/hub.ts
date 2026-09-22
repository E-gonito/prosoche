/**
 * The running hub: one vault, one index, one sync provider, wired together.
 *
 * Route handlers import `hub()` and nothing else from the server modules, so
 * this file is the single place that decides how the pieces connect and the
 * only place that holds process-wide state.
 */

import { config } from './config';
import { NoteIndex } from './index/index';
import { Vault, type FileChange } from './vault/index';
import { GitSync } from './vault/git-sync';
import { loadWorkspaces, seedWorkspaces, type Workspace } from './workspaces';
import { startSchedule } from './ai/schedule';

/**
 * Keep an index true to a vault, and hand back the way to rebuild it.
 *
 * Inputs: the vault to follow and the index to fill. Output: a rebuild
 * function that resolves with how long the build took. Side effects: a
 * subscription to the vault that lasts as long as the process, and writes to
 * the index.
 *
 * A rebuild reads every note and then replaces the whole index in one
 * transaction. Reading is asynchronous, so a file written between the read
 * and the replace — by the editor, by git, by another process holding the
 * same vault — would be indexed as it was before, and no event is left to
 * correct it: the index disagrees with the disk until something touches that
 * file again, which shows up later as a phantom conflict on an edit or a
 * missing line in a widget. So a rebuild remembers what changed underneath it
 * and reindexes those paths before it resolves. Callers therefore never have
 * to race the file watcher: once `rebuild()` resolves, the index matches the
 * disk as it was when reading finished.
 *
 * Exported so a test can drive it with a real vault and a memory index.
 */
export function indexVault(vault: Vault, index: NoteIndex): () => Promise<number> {
	/** Paths changed while a rebuild is reading, or null when none is. */
	let underway: Set<string> | null = null;

	// Whatever happened to a path, the answer is the same: make the index say
	// what the disk says. A file that has since been deleted reads as missing,
	// which is why a removal needs no case of its own.
	const resync = async (path: string): Promise<void> => {
		const note = await vault.read(path);
		if (note.exists) index.put(path, note.content, note.mtimeMs, note.hash);
		else index.forget(path);
	};

	// A change from any source reindexes just that file. Subscribing here
	// rather than inside Vault keeps the vault ignorant of the index.
	vault.subscribe((change) => {
		underway?.add(change.path);
		void resync(change.path);
	});

	return async () => {
		const changed = (underway = new Set<string>());
		let took: number;
		try {
			const notes = [];
			for (const path of await vault.list()) {
				const note = await vault.read(path);
				notes.push({ path, content: note.content, mtimeMs: note.mtimeMs, hash: note.hash });
			}
			took = index.rebuild(notes);
		} finally {
			// Only this rebuild's own tracker, so a second one overlapping it
			// keeps collecting for itself.
			if (underway === changed) underway = null;
		}
		for (const path of changed) await resync(path);
		return took;
	};
}

export interface Hub {
	vault: Vault;
	index: NoteIndex;
	/** Resolves once the first full index build has finished. */
	ready: Promise<void>;
	/** Subscribe to vault changes, e.g. to feed a server-sent event stream. */
	subscribe(listener: (change: FileChange) => void): () => void;
	/** Throw away the index and build it again from the markdown. */
	rebuild(): Promise<number>;
	/** Workspace definitions from `_hub/workspaces/`, re-read on demand. */
	workspaces(): Promise<Workspace[]>;
}

let instance: Hub | null = null;

export function hub(): Hub {
	if (!instance) instance = start();
	return instance;
}

function start(): Hub {
	const sync = new GitSync(config.vaultPath);
	const vault = new Vault(config.vaultPath, sync);
	const index = new NoteIndex(config.dbPath);

	const rebuild = indexVault(vault, index);

	const ready = rebuild().then(
		async (ms) => {
			console.log(`[hub] indexed ${index.health().notes} notes in ${ms} ms`);
			const seeded = await seedWorkspaces(vault);
			if (seeded.length) console.log(`[hub] created ${seeded.length} workspace files under _hub/workspaces/`);
			vault.watch();
			sync.start();
			// After the first index, because the briefing's facts are queries
			// against it and an empty index would write an empty briefing.
			startSchedule({ vault, index });
		},
		(e) => {
			console.error('[hub] initial index failed', e);
		}
	);

	return {
		vault,
		index,
		ready,
		subscribe: (l) => vault.subscribe(l),
		rebuild,
		workspaces: () => loadWorkspaces(vault)
	};
}

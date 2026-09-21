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

	const rebuild = async (): Promise<number> => {
		const paths = await vault.list();
		const notes = [];
		for (const path of paths) {
			const note = await vault.read(path);
			notes.push({ path, content: note.content, mtimeMs: note.mtimeMs, hash: note.hash });
		}
		return index.rebuild(notes);
	};

	// A change from any source reindexes just that file. Doing it here rather
	// than inside Vault keeps the vault ignorant of the index.
	vault.subscribe((change) => {
		void reindex(change);
	});

	async function reindex(change: FileChange): Promise<void> {
		if (change.kind === 'removed') {
			index.forget(change.path);
			return;
		}
		const note = await vault.read(change.path);
		if (note.exists) index.put(change.path, note.content, note.mtimeMs, note.hash);
	}

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

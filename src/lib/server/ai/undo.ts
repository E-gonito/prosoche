/**
 * The AI layer's undo store, and its only filesystem code.
 *
 * Elsewhere in this codebase `src/lib/server/vault/` owns every file
 * operation. The AI layer needs two things the vault module cannot give it:
 * a place outside the vault to snapshot files before applying a proposal
 * (G9, `config.undoPath`), and a symlink check on a path about to be written
 * (G4). Both live here so there is exactly one file to audit, and the rule it
 * keeps is short enough to state in a line: **this module reads the vault and
 * writes only under `config.undoPath`.** No code path here opens a vault file
 * for writing.
 */

import { mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { config } from '../config';

/**
 * Whether a vault-relative path resolves to a real location inside the vault.
 *
 * The textual half of G4 cannot see a symlink: `Inbox/notes.md` is a perfectly
 * ordinary path even when `Inbox` is a link to `/etc`. This closes that, and
 * lives here because this is the module allowed to call the filesystem.
 *
 * Inputs: a vault-relative path. Output: true when writing it would stay
 * inside the vault, including when the file does not exist yet, in which case
 * the nearest existing ancestor is what gets checked.
 *
 * Side effects: reads the filesystem. Never writes anything, anywhere.
 */
export async function resolvesInsideVault(path: string, vaultPath: string = config.vaultPath): Promise<boolean> {
	const vaultReal = await realpath(vaultPath).catch(() => null);
	if (vaultReal === null) return false;

	const parts = path.split('/');
	for (let depth = parts.length; depth > 0; depth--) {
		const candidate = join(vaultReal, ...parts.slice(0, depth));
		const resolved = await realpath(candidate).catch(() => null);
		if (resolved === null) continue;
		return resolved === vaultReal || resolved.startsWith(vaultReal + sep);
	}
	// Nothing along the path exists yet, so only the vault root is involved.
	return true;
}

/* ------------------------------------------------- the undo snapshot store -- */

interface SnapshotEntry {
	id: string;
	/** ISO timestamp the snapshot was taken. */
	at: string;
	proposalId: string;
	paths: string[];
}

/**
 * Copy the current bytes of every file a proposal is about to change into
 * `config.undoPath`, before anything is written.
 *
 * Inputs: the proposal's id, and the files as they are now - a path with
 * `content: null` records that the file did not exist, so undo can tell "put
 * it back" from "there was nothing here". Output: the snapshot id, which is
 * what an undo is addressed by.
 *
 * Side effects: creates `<undoPath>/<id>/` and writes a copy of each file plus
 * a manifest. Never writes inside the vault, and never removes anything: a
 * snapshot is only deleted by `pruneSnapshots`.
 */
export async function snapshot(
	proposalId: string,
	files: Array<{ path: string; content: string | null }>,
	undoPath: string = config.undoPath,
	now = new Date()
): Promise<SnapshotEntry> {
	const stamp = now.toISOString().replace(/[:.]/g, '-');
	const id = `${stamp}-${proposalId}`;
	const dir = join(undoPath, id);

	for (const file of files) {
		if (file.content === null) continue;
		const target = join(dir, 'files', ...file.path.split('/'));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, file.content, 'utf8');
	}

	const entry: SnapshotEntry = { id, at: now.toISOString(), proposalId, paths: files.map((f) => f.path) };
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...entry, files: files.map((f) => ({ path: f.path, existed: f.content !== null })) }, null, '\t'), 'utf8');
	return entry;
}

/**
 * Read a snapshot back.
 *
 * Inputs: a snapshot id. Output: the files it holds, with `content: null` for
 * one that did not exist when the snapshot was taken. An unknown id gives an
 * empty list rather than an error, because a snapshot pruned after seven days
 * is a normal thing to ask about.
 *
 * Side effects: reads the snapshot directory. Never writes, and never restores
 * anything itself - putting the bytes back is `proposal.undo`, through the
 * vault module, so an undo goes through the same write path as any other edit.
 */
export async function readSnapshot(
	id: string,
	undoPath: string = config.undoPath
): Promise<Array<{ path: string; content: string | null }>> {
	const dir = join(undoPath, id);
	const raw = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => null);
	if (raw === null) return [];
	let manifest: { files?: Array<{ path: string; existed: boolean }> };
	try {
		manifest = JSON.parse(raw) as { files?: Array<{ path: string; existed: boolean }> };
	} catch {
		return [];
	}

	const out: Array<{ path: string; content: string | null }> = [];
	for (const file of manifest.files ?? []) {
		if (!file.existed) {
			out.push({ path: file.path, content: null });
			continue;
		}
		const content = await readFile(join(dir, 'files', ...file.path.split('/')), 'utf8').catch(() => null);
		out.push({ path: file.path, content });
	}
	return out;
}

/** Snapshots still on disk, newest first. Reads only; never prunes. */
export async function listSnapshots(undoPath: string = config.undoPath): Promise<SnapshotEntry[]> {
	const names = await readdir(undoPath).catch(() => [] as string[]);
	const out: SnapshotEntry[] = [];
	for (const name of names) {
		const raw = await readFile(join(undoPath, name, 'manifest.json'), 'utf8').catch(() => null);
		if (raw === null) continue;
		try {
			const entry = JSON.parse(raw) as SnapshotEntry;
			if (entry.id) out.push(entry);
		} catch {
			// A half-written manifest is not worth failing a page over.
		}
	}
	return out.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Delete snapshots older than `days`, which the spec fixes at seven.
 * `proposal.apply` calls it after every snapshot, which is what makes the
 * settings page's "kept for seven days" true.
 *
 * Inputs: a retention window. Output: how many were removed.
 * Side effects: removes directories under `config.undoPath` only. Never
 * touches the vault, and never removes a snapshot it cannot date, so a
 * manifest this version does not understand is kept rather than discarded.
 */
export async function pruneSnapshots(days = 7, undoPath: string = config.undoPath, now = new Date()): Promise<number> {
	const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
	let removed = 0;
	for (const entry of await listSnapshots(undoPath)) {
		const at = Date.parse(entry.at);
		if (!Number.isFinite(at) || at >= cutoff) continue;
		await rm(join(undoPath, entry.id), { recursive: true, force: true });
		removed++;
	}
	return removed;
}

/**
 * Remember that a proposal was applied, and what it wrote.
 *
 * This is what makes `apply` safe to call twice: a double-clicked Accept, a
 * retried request or a replayed POST finds the receipt and returns it instead
 * of appending the same text again.
 *
 * Inputs: the proposal id and the result. Output: nothing.
 * Side effects: writes one small file under `config.undoPath`. Never in the
 * vault, because a receipt is hub bookkeeping and not the user's note.
 */
export async function recordApplied(proposalId: string, result: unknown, undoPath: string = config.undoPath): Promise<void> {
	const dir = join(undoPath, 'applied');
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${safeId(proposalId)}.json`), JSON.stringify(result), 'utf8');
}

/** The receipt for a proposal already applied, or null. Reads only. */
export async function appliedResult<T>(proposalId: string, undoPath: string = config.undoPath): Promise<T | null> {
	const raw = await readFile(join(undoPath, 'applied', `${safeId(proposalId)}.json`), 'utf8').catch(() => null);
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/** Ids come from our own code, but a receipt must never become a path escape. */
function safeId(id: string): string {
	return id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96) || 'unnamed';
}

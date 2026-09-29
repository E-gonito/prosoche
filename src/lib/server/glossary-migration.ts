/**
 * Moving the old per-workspace glossaries into `Glossaries/`.
 *
 * Glossaries used to live in a workspace's folder as `Glossary.md`. They are
 * now standalone files, `Glossaries/<name>.md`, and a workspace points at one
 * with `glossary: <name>`. This module moves the old files across once, at
 * hub start, and is safe to run on every start: once no old file is left it
 * does nothing.
 *
 * The rule, for each workspace and each of its folders:
 *
 * - A `Glossary.md` directly in the folder moves to `Glossaries/<name>.md`,
 *   where the name is the folder's own name (the last part of its path), not
 *   the workspace's: `Computer Science/Glossary.md` becomes
 *   `Glossaries/Computer Science.md` although its workspace is "CS study".
 *   The folder is what the user named the subject after.
 * - The bytes are copied unchanged, then the old file is removed with
 *   `vault.remove`, so git history keeps it.
 * - A file already at the target is never overwritten. If it holds the very
 *   same bytes, a move that was interrupted after the copy is finished by
 *   removing the old file; otherwise both are left alone and reported.
 * - A workspace with `meetings: true` and no `glossary:` yet, whose home
 *   (first) folder held the file, gets `glossary: <name>`, written as a span
 *   edit of its definition, because that is the glossary its meetings were
 *   capturing into. A workspace without meetings is left as it is.
 */

import { GLOSSARY_FOLDER, glossaryPath } from './glossary';
import { setFrontmatterField } from './parse/frontmatter';
import { rewrite } from './rewrite';
import type { Workspace } from './workspaces';
import { hashContent, type Vault } from './vault/index';

/** The file name the old layout kept a workspace's glossary under. */
const OLD_NAME = 'Glossary.md';

/** One old glossary to move. */
export interface GlossaryMove {
	/** The old file, e.g. `Work Projects/eye2gene/Glossary.md`. */
	from: string;
	/** The folder's own name, e.g. `eye2gene`. */
	name: string;
	/** Where it goes, e.g. `Glossaries/eye2gene.md`. */
	to: string;
	/** Workspaces to point at it with `glossary: <name>`. */
	link: Workspace[];
}

/** What a migration did, for the start-up log. */
export interface MigrationReport {
	moved: Array<{ from: string; to: string }>;
	linked: Array<{ workspace: string; glossary: string }>;
	/** Old files left where they are, and why. */
	left: Array<{ from: string; to: string; why: string }>;
}

/**
 * The moves to make, given the workspaces and every note path in the vault.
 * Pure.
 *
 * One move per old file, even when two workspaces share the folder that
 * holds it; a folder named `Glossaries` itself, or one whose name cannot be
 * a glossary's, is skipped. `link` holds each workspace with meetings and no
 * `glossary:` whose first folder is the one that held the file.
 */
export function planGlossaryMoves(workspaces: Workspace[], paths: string[]): GlossaryMove[] {
	const present = new Set(paths);
	const moves = new Map<string, GlossaryMove>();
	for (const workspace of workspaces) {
		workspace.folders.forEach((raw, i) => {
			const folder = raw.replace(/^\/+|\/+$/g, '');
			if (!folder || folder === GLOSSARY_FOLDER) return;
			const from = `${folder}/${OLD_NAME}`;
			if (!present.has(from)) return;
			const name = folder.split('/').pop()!;
			const to = glossaryPath(name);
			if (!to) return;
			const move = moves.get(from) ?? { from, name, to, link: [] };
			if (i === 0 && workspace.meetings && !workspace.glossary && !move.link.includes(workspace)) move.link.push(workspace);
			moves.set(from, move);
		});
	}
	return [...moves.values()];
}

/**
 * Move every old `Glossary.md` into `Glossaries/` by the rule above, and
 * point the workspaces with meetings at their glossary.
 *
 * Side effects: writes each new file, removes each old one, and rewrites the
 * `glossary:` line of the workspaces it links; all through the vault, so
 * each change is committed. Never overwrites a file in `Glossaries/`, never
 * removes an old file whose bytes are not safely at the target, and never
 * throws on a clash: an old file that changes mid-move has its fresh copy
 * taken back, is left for the next start, and is reported.
 */
export async function migrateGlossaries(vault: Vault, workspaces: Workspace[]): Promise<MigrationReport> {
	const report: MigrationReport = { moved: [], linked: [], left: [] };
	for (const move of planGlossaryMoves(workspaces, await vault.list())) {
		const old = await vault.read(move.from);
		if (!old.exists) continue;
		const target = await vault.read(move.to);
		if (target.exists && target.content !== old.content) {
			report.left.push({ from: move.from, to: move.to, why: `${move.to} already exists` });
			continue;
		}
		let copy: string | null = null;
		if (!target.exists) {
			const copied = await vault.write(move.to, old.content, hashContent(''));
			if (!copied.ok) {
				report.left.push({ from: move.from, to: move.to, why: `${move.to} appeared during the move` });
				continue;
			}
			copy = copied.note.hash;
		}
		const removed = await vault.remove(move.from, old.hash);
		if (!removed.ok) {
			// Take the copy back, so the next start moves the file as it is then.
			if (copy) await vault.remove(move.to, copy);
			report.left.push({ from: move.from, to: move.to, why: `${move.from} changed during the move` });
			continue;
		}
		report.moved.push({ from: move.from, to: move.to });
		for (const workspace of move.link) {
			const linked = await rewrite(vault, workspace.path, (content) => setFrontmatterField(content, 'glossary', move.name), 2);
			if (linked.ok) report.linked.push({ workspace: workspace.slug, glossary: move.name });
		}
	}
	return report;
}

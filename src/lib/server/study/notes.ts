/**
 * A subject's own notes: the folders a study subject names, as a tree to
 * browse and one note at a time to read, inside the subject's Notes tab.
 *
 * Read-only throughout. Which folders count is the subject's own list (the
 * `folders:` of its file in `_hub/subjects/`), so pointing CS study at `Computer Science/` is what
 * puts those notes here; nothing is copied or indexed a second time. A note
 * outside those folders is not shown here, however it is asked for: the tab
 * is a window on the subject, and the vault-wide reader is `/notes`.
 */

import { parseNote, basename } from '../parse/note';
import { renderNote } from '../render';
import { isMarkdown } from '../vault/paths';
import type { NoteIndex } from '../index/index';
import type { TreeNode, Vault } from '../vault/index';

/** One note as the Notes tab shows it. */
interface SubjectNote {
	path: string;
	title: string;
	/** Rendered body, wikilinks resolved to `/notes/...`. */
	html: string;
	tags: string[];
}

/**
 * The part of the vault's tree under each of `folders`, in the order given,
 * one top-level folder node per folder that exists. Each keeps its full
 * vault-relative path as its name, so two subject folders called `Notes` in
 * different places stay distinguishable. A folder that is not in the tree,
 * or is inside one already taken, is left out. Pure.
 */
export function subjectTree(tree: TreeNode[], folders: string[]): TreeNode[] {
	const clean = folders.map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean);
	const out: TreeNode[] = [];
	for (const folder of clean) {
		if (clean.some((other) => other !== folder && folder.startsWith(`${other}/`))) continue;
		const node = find(tree, folder);
		if (node) out.push({ ...node, name: folder });
	}
	return out;
}

/** Every note path under the tree, depth first. Pure. */
export function notePaths(tree: TreeNode[]): string[] {
	return tree.flatMap((node) => (node.type === 'note' ? [node.path] : notePaths(node.children)));
}

/**
 * Read one note for the tab, or null when `path` is not a markdown note
 * inside one of `folders`, or is not there. Wikilinks in the body link to the
 * vault-wide reader. Never writes.
 */
export async function readSubjectNote(vault: Vault, index: NoteIndex, folders: string[], path: string): Promise<SubjectNote | null> {
	if (!isMarkdown(path) || path.includes('..')) return null;
	if (!folders.some((f) => path.startsWith(`${f.replace(/^\/+|\/+$/g, '')}/`))) return null;
	const note = await vault.read(path);
	if (!note.exists) return null;
	const parsed = parseNote(note.content, path);
	return {
		path,
		title: parsed.title || basename(path),
		html: renderNote(index, parsed.body),
		tags: parsed.tags
	};
}

function find(nodes: TreeNode[], path: string): Extract<TreeNode, { type: 'folder' }> | null {
	for (const node of nodes) {
		if (node.type !== 'folder') continue;
		if (node.path === path) return node;
		if (path.startsWith(`${node.path}/`)) return find(node.children, path);
	}
	return null;
}

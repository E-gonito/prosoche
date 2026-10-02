/**
 * Subjects: what Study is divided into.
 *
 * A subject is one markdown file in `_hub/subjects/`, the way a workspace is
 * one in `_hub/workspaces/`, and the two have nothing to do with each other:
 * a subject is never a workspace, never shows among them, and claims no task
 * or note for one. There can be any number of subjects. Nothing is shared
 * between two but the code: each has its own home folder holding its own
 * `Goals.md` and `Reading List.md`, and its own scope, its
 * folders and tag, for its notes. Flashcards are not Study's; they are the
 * glossaries' (see `flashcards/decks.ts`).
 *
 *     ---
 *     name: Filipino
 *     color: "#7c3aed"
 *     folders:
 *       - "Study/Filipino"
 *       - "Languages/Filipino"
 *     ---
 *
 * The first folder is the home; a file naming none is homed at
 * `Study/<name>`. `tag:` is optional and, when there, puts notes carrying it
 * in scope too.
 *
 * This module is the one place that reads and writes that file, so a page
 * and a route agree on where a subject's files are. It
 * never reads a note; it only says where they live.
 */

import { config } from '../config';
import { setFrontmatterField } from '../parse/frontmatter';
import { parseNote, setLede } from '../parse/note';
import { invalid, rewrite, type Written } from '../rewrite';
import { slugify } from '$lib/shared/slug';
import type { StudyScope, SubjectRef } from '$lib/shared/study';
import { folderList, type Vault } from '../vault/index';

/** Where subject files live. */
const SUBJECT_DIR = `${config.hubFolder}/subjects`;

/** The folder new subjects are homed under: `Study/<Name>`. */
const STUDY_ROOT = 'Study';

/** A subject, with where its files are and which notes it covers. */
export interface Subject extends SubjectRef {
	scope: StudyScope;
	/** Its definition file, `_hub/subjects/<slug>.md`. */
	path: string;
	files: {
		goals: string;
		reading: string;
	};
}

/** Every subject, in file-name order. Never throws; a vault with none has none. */
export async function loadSubjects(vault: Vault): Promise<Subject[]> {
	const paths = (await vault.list()).filter((p) => p.startsWith(`${SUBJECT_DIR}/`) && !p.slice(SUBJECT_DIR.length + 1).includes('/')).sort();
	const subjects: Subject[] = [];
	for (const path of paths) {
		const note = await vault.read(path);
		if (note.exists) subjects.push(readSubject(path, note.content));
	}
	return subjects;
}

/** The subject with this slug, or null when there is none. Pure. */
export function subjectOf(subjects: Subject[], slug: unknown): Subject | null {
	return subjects.find((s) => s.slug === slug) ?? null;
}

type SubjectCreated =
	| { ok: true; subject: Subject }
	| { ok: false; reason: 'no-name' | 'exists'; message: string };

/**
 * Create a subject: a file in `_hub/subjects/`, homed at `Study/<name>`,
 * with `extraFolders` after the home as reference folders whose notes are
 * its too, and a colour no other subject has while one is free.
 *
 * Writes that one file and never overwrites one. The home folder itself
 * appears with the subject's first write. Refuses a name that makes no
 * folder or no slug, and a slug another subject has. A workspace of the
 * same name is no clash.
 */
export async function createSubject(vault: Vault, spec: { name: string; extraFolders?: string[] }): Promise<SubjectCreated> {
	// A folder name and a link target both: no path separators, nothing
	// Obsidian refuses in a file name, nothing a wikilink would read.
	const name = spec.name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
	const slug = slugify(name);
	if (!name || !slug) return { ok: false, reason: 'no-name', message: 'A subject needs a name with a letter or digit in it.' };

	const home = `${STUDY_ROOT}/${name}`;
	const folders = folderList(spec.extraFolders ?? [], home) ?? [home];
	const taken = new Set((await loadSubjects(vault)).map((s) => s.color));
	const color = PALETTE.find((c) => !taken.has(c)) ?? PALETTE[taken.size % PALETTE.length];

	const path = `${SUBJECT_DIR}/${slug}.md`;
	const exists = { ok: false, reason: 'exists', message: 'A subject with that name already exists. Pick a different name.' } as const;
	if ((await vault.read(path)).exists) return exists;
	const result = await vault.write(path, renderSubject(name, color, folders));
	if (!result.ok) return exists;
	return { ok: true, subject: readSubject(path, result.note.content) };
}

/** The parts of a subject's file a person edits from the app. */
export interface SubjectEdit {
	name?: string;
	/** `#rrggbb`. */
	color?: string;
	/** A tag whose notes are in scope too, a leading `#` dropped; empty for none. */
	tag?: string;
	/** The one-line description: the file's first paragraph. Empty removes it. */
	description?: string;
	/** Every folder wanted after the home, in order: the reference folders. */
	folders?: string[];
}

/**
 * Change a subject's file: each field of `edit` that is present, and nothing
 * else. Frontmatter through `parse/frontmatter.ts`, the description through
 * `setLede`, so every other byte is kept. The slug, which is the file name,
 * never changes, and neither does the home, which stays first: its goals,
 * and reading list are there. A subject whose file names no
 * folder is homed at `Study/<name>`, and that is the home kept.
 *
 * Refuses, writing nothing, an empty name, a colour that is not `#rrggbb`, a
 * tag that is not one (letters, digits, `_`, `-` and `/`, starting with a
 * letter) and a folder with a `.` or `..` segment, as invalid; returns a conflict
 * after two clashing writes. Never touches a folder or a note in one.
 */
export async function editSubject(vault: Vault, subject: Subject, edit: SubjectEdit): Promise<Written> {
	const fields: Array<[string, string | string[]]> = [];
	if (edit.name !== undefined) {
		if (!edit.name.trim()) return invalid('A subject needs a name.');
		fields.push(['name', edit.name.trim()]);
	}
	if (edit.color !== undefined) {
		if (!/^#[0-9a-f]{6}$/i.test(edit.color.trim())) return invalid('A colour is written #rrggbb.');
		fields.push(['color', edit.color.trim().toLowerCase()]);
	}
	if (edit.tag !== undefined) {
		const tag = edit.tag.trim().replace(/^#/, '');
		if (tag && !/^[A-Za-z][\w/-]*$/.test(tag)) return invalid('A tag is letters, digits, _, - and /, starting with a letter.');
		fields.push(['tag', tag]);
	}
	if (edit.folders !== undefined) {
		const folders = folderList(edit.folders, subject.scope.folders?.[0]);
		if (!folders) return invalid('A folder is a path from the top of the vault, without . or .. in it.');
		fields.push(['folders', folders]);
	}
	return rewrite(
		vault,
		subject.path,
		(content) => {
			const next = fields.reduce((text, [key, value]) => setFrontmatterField(text, key, value), content);
			return edit.description === undefined ? next : setLede(next, edit.description);
		},
		2
	);
}

/**
 * Delete a subject: remove its file, `_hub/subjects/<slug>.md`, and nothing
 * else. Its home folder, goals, reading list and notes stay
 * where they are; git history still has the file. Refuses an unknown slug.
 */
export async function deleteSubject(vault: Vault, slug: string): Promise<{ ok: true } | { ok: false; reason: 'not-found' }> {
	if (!slug || slug.includes('/')) return { ok: false, reason: 'not-found' };
	const result = await vault.remove(`${SUBJECT_DIR}/${slug}.md`);
	return result.ok ? { ok: true } : { ok: false, reason: 'not-found' };
}

/**
 * Move every subject still defined as a workspace — a file in
 * `_hub/workspaces/` whose frontmatter says `template: study`, from before
 * subjects had files of their own — to `_hub/subjects/`, byte for byte.
 * Answers the paths written.
 *
 * Writes the new file first and removes the old one only once it is there,
 * so a failure leaves the subject a workspace rather than nowhere. Skips a
 * slug that already has a subject file, leaving both. Idempotent: once no
 * workspace says `template: study` it does nothing. Delete it once no vault
 * has one.
 */
export async function adoptStudyWorkspaces(vault: Vault): Promise<string[]> {
	const moved: string[] = [];
	const dir = `${config.hubFolder}/workspaces/`;
	for (const path of await vault.list()) {
		if (!path.startsWith(dir) || path.slice(dir.length).includes('/')) continue;
		const note = await vault.read(path);
		if (!note.exists || parseNote(note.content, path).frontmatter.template !== 'study') continue;
		const target = `${SUBJECT_DIR}/${path.slice(dir.length)}`;
		if ((await vault.read(target)).exists) continue;
		if (!(await vault.write(target, note.content)).ok) continue;
		await vault.remove(path, note.hash);
		moved.push(target);
	}
	return moved;
}

/** Colours for new subjects, from the design tokens, used in turn. */
const PALETTE = ['#7c3aed', '#2e6b85', '#c2553f', '#3f7d4e', '#c8962b', '#a8641c'];

/**
 * The subject a file in `_hub/subjects/` defines, from its path and text.
 * Pure; never throws. A field missing or malformed reads as its default.
 */
export function readSubject(path: string, content: string): Subject {
	const fm = parseNote(content, path).frontmatter;
	const slug = (path.split('/').pop() ?? '').replace(/\.md$/, '');
	const folders = strList(fm.folders);
	const tag = str(fm.tag)?.replace(/^#/, '');
	const home = folders[0] ?? `${STUDY_ROOT}/${str(fm.name) ?? slug}`;
	return {
		slug,
		name: str(fm.name) ?? slug,
		color: str(fm.color) ?? '#6b7280',
		home,
		scope: { folders: folders.length ? folders : [home], tags: tag ? [tag] : [] },
		path,
		files: {
			goals: `${home}/Goals.md`,
			reading: `${home}/Reading List.md`
		}
	};
}

/** A subject file a human can read and edit in Obsidian. */
function renderSubject(name: string, color: string, folders: string[]): string {
	return `---
name: ${name}
color: "${color}"
folders:
${folders.map((f) => `  - ${JSON.stringify(f)}`).join('\n')}
---

Created from Study.

Edit this file to change the subject: its name, colour, and the folders its
notes come from. The first folder is its home, where its goals and reading
list are kept.
`;
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strList(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

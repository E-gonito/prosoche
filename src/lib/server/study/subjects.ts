/**
 * Subjects: what Study is divided into.
 *
 * A subject is a workspace whose file says `template: study` — CS, Filipino,
 * whatever comes next — and there can be any number. Nothing is shared
 * between two subjects but the code: each has its own home folder holding
 * its own `Goals.md`, `Reading List.md`, `Sessions.md` and `Flashcards/`,
 * and its own scope, the workspace's folders and tag, for its cards.
 *
 * This module is the one place that turns a workspace into a subject, so a
 * page, a route and the Anki import all agree on where a subject's files
 * are. It never reads a note; it only says where they live.
 */

import { createWorkspace, homeFolder, type Workspace } from '../workspaces';
import { inScope, scopeOf } from './scope';
import { slugify } from '$lib/shared/slug';
import type { StudyScope, SubjectRef } from '$lib/shared/study';
import type { Vault } from '../vault/index';

/** The `template:` value that makes a workspace a subject. */
export const STUDY_TEMPLATE = 'study';

/**
 * How many never-reviewed cards join a subject's reviews each day when its
 * workspace file does not say, with `new_per_day:`.
 */
export const NEW_PER_DAY = 20;

/** The folder new subjects are homed under: `Study/<Name>`. */
const STUDY_ROOT = 'Study';

/** A subject, with where its files are and which notes it covers. */
export interface Subject extends SubjectRef {
	scope: StudyScope;
	/** Cards never reviewed that may join its reviews each day; 0 for none. */
	newPerDay: number;
	files: {
		goals: string;
		reading: string;
		sessions: string;
		/** The folder card files are written to. */
		flashcards: string;
	};
}

/**
 * Every subject among the workspaces, in workspace order. Pure. A workspace
 * that is not a subject is simply not in the list.
 */
export function subjectsOf(workspaces: Workspace[]): Subject[] {
	return workspaces.filter((w) => w.template === STUDY_TEMPLATE).map(toSubject);
}

/** The subject with this slug, or null when there is none. Pure. */
export function subjectOf(workspaces: Workspace[], slug: string): Subject | null {
	return subjectsOf(workspaces).find((s) => s.slug === slug) ?? null;
}

/**
 * The subject a note belongs to — the first whose folders hold it or whose
 * tag it carries — or null when it is in none. Pure. This is what puts
 * "Make cards" on a note.
 */
export function subjectFor(workspaces: Workspace[], path: string, tags: string[]): Subject | null {
	return subjectsOf(workspaces).find((s) => inScope(path, tags, s.scope)) ?? null;
}

/**
 * The study home of subject `slug`: the folder its `Goals.md`, `Reading
 * List.md`, `Sessions.md` and `Flashcards/` live in, vault-relative. Null for
 * a slug that is not a subject. Pure; the one answer every writer of a
 * subject's own files should ask for.
 */
export function studyHome(workspaces: Workspace[], slug: string): string | null {
	return subjectOf(workspaces, slug)?.home ?? null;
}

export type SubjectCreated =
	| { ok: true; subject: Subject }
	| { ok: false; reason: 'no-name' | 'exists' | 'reserved'; message: string };

/**
 * Create a subject: a workspace file with `template: study`, homed at
 * `Study/<name>`, with `extraFolders` after the home as reference folders
 * whose notes count for its cards.
 *
 * Writes one file, `_hub/workspaces/<slug>.md`, through `createWorkspace`,
 * and never overwrites one. The home folder itself appears with the
 * subject's first write. Refuses a name that makes no folder or no slug, and
 * `review`, which `/study/review` already means.
 */
export async function createSubject(
	vault: Vault,
	existing: Workspace[],
	spec: { name: string; extraFolders?: string[] }
): Promise<SubjectCreated> {
	// A folder name and a link target both: no path separators, nothing
	// Obsidian refuses in a file name, nothing a wikilink would read.
	const name = spec.name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
	if (!name) return { ok: false, reason: 'no-name', message: 'A subject needs a name.' };
	if (slugify(name) === 'review') return { ok: false, reason: 'reserved', message: '"Review" is taken by the review page. Pick another name.' };

	const home = `${STUDY_ROOT}/${name}`;
	const folders = [home, ...(spec.extraFolders ?? []).map((f) => f.trim().replace(/^\/+|\/+$/g, '')).filter((f) => f && f !== home)];
	const taken = new Set(existing.filter((w) => w.template === STUDY_TEMPLATE).map((w) => w.color));
	const color = PALETTE.find((c) => !taken.has(c)) ?? PALETTE[taken.size % PALETTE.length];

	const created = await createWorkspace(vault, { name, color, folders, template: STUDY_TEMPLATE });
	if (created.ok) return { ok: true, subject: toSubject(created.workspace) };
	return created.reason === 'no-name'
		? { ok: false, reason: 'no-name', message: 'A subject needs a name with a letter or digit in it.' }
		: { ok: false, reason: 'exists', message: 'A workspace with that name already exists. Pick a different name.' };
}

/** Colours for new subjects, from the design tokens, used in turn. */
const PALETTE = ['#7c3aed', '#2e6b85', '#c2553f', '#3f7d4e', '#c8962b', '#a8641c'];

function toSubject(workspace: Workspace): Subject {
	const home = homeFolder(workspace);
	return {
		slug: workspace.slug,
		name: workspace.name,
		color: workspace.color,
		home,
		scope: scopeOf(workspace),
		newPerDay: workspace.newPerDay ?? NEW_PER_DAY,
		files: {
			goals: `${home}/Goals.md`,
			reading: `${home}/Reading List.md`,
			sessions: `${home}/Sessions.md`,
			flashcards: `${home}/Flashcards`
		}
	};
}

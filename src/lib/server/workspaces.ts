/**
 * Workspaces: the areas a vault is divided into, such as work, study and
 * personal.
 *
 * A workspace is one markdown file in `_hub/workspaces/`, so it is editable in
 * Obsidian and travels with the vault. Its frontmatter names the workspace and
 * where its notes live; this module only reads and writes the definitions, and
 * answers the one question everything else needs: does this note or task
 * belong to this workspace?
 *
 * Earlier versions let a workspace file list `tabs:` of named widgets. The
 * rebuild gives every workspace the same sections instead — Overview, Inbox,
 * Log, People, Notes, and a tab per file in `Pages/` — so `tabs:` is no
 * longer read. A file that still has one from before is parsed the same as
 * any other frontmatter the hub does not recognise: harmlessly ignored.
 */

import { parseNote } from './parse/note';
import { slugify } from '$lib/shared/slug';
import { displayText } from '$lib/shared/task';
import { config } from './config';
import type { Vault } from './vault/index';

/** The pipeline a workspace's deals move through, unless its file says otherwise. */
export const DEFAULT_STAGES = ['lead', 'proposal', 'negotiation', 'won', 'lost'];

export interface Workspace {
	/** Derived from the file name, e.g. `_hub/workspaces/study.md` -> `study`. */
	slug: string;
	name: string;
	color: string;
	/** Tag that assigns a task to this workspace, without the `#`. */
	tag: string;
	/**
	 * Words that name this workspace in a task the user wrote without a tag,
	 * e.g. `eye2gene`, `cusina ko`. Matched whole-word and case-insensitively,
	 * and only as the last resort, because they are a guess where a tag is a
	 * statement. Empty for a workspace whose file declares none.
	 */
	aliases: string[];
	folders: string[];
	/**
	 * What kind of workspace this is, from `template:` in its file. Only one
	 * value means anything today: `study` marks the workspace the Study module
	 * reads. Absent for an ordinary project.
	 */
	template?: string;
	/** Deal pipeline stages, in order. `DEFAULT_STAGES` unless the file sets its own. */
	stages: string[];
	path: string;
}

const WORKSPACE_DIR = `${config.hubFolder}/workspaces`;

/** Read every workspace definition, in display order. Never throws. */
export async function loadWorkspaces(vault: Vault): Promise<Workspace[]> {
	const paths = (await vault.list()).filter((p) => p.startsWith(`${WORKSPACE_DIR}/`));
	const workspaces: Workspace[] = [];
	for (const path of paths) {
		const note = await vault.read(path);
		if (note.exists) workspaces.push(toWorkspace(path, parseNote(note.content, path).frontmatter));
	}
	return workspaces;
}

/**
 * Which workspace a note or task belongs to, checked in the order the spec
 * fixes: explicit tag, then containing folder, then a `workspace:` field, then
 * an alias in the task's own words. Returns null for anything unassigned
 * rather than guessing.
 *
 * `text` is the task line's text, and is optional: a caller that does not pass
 * it simply never reaches the alias rule. Aliases are matched whole-word and
 * case-insensitively against `displayText(text)`, so "Kaya" claims "Work on
 * Kaya" and not "Buy a kayak", and a metacharacter in an alias is a character
 * rather than a pattern.
 *
 * Being last is the whole point of the rule. A note inside a workspace's
 * folder is already claimed by the folder, so it can never be reassigned by a
 * word in its text; only lines that belong nowhere — the daily notes and the
 * Inbox — are ever attributed this way.
 */
export function workspaceFor(
	workspaces: Workspace[],
	input: { path: string; tags?: string[]; frontmatter?: Record<string, unknown>; text?: string }
): Workspace | null {
	const tags = input.tags ?? [];
	const byTag = workspaces.find((w) => tags.includes(w.tag));
	if (byTag) return byTag;

	const byFolder = workspaces
		.filter((w) => w.folders.some((f) => input.path === f || input.path.startsWith(`${f}/`)))
		// Deepest folder wins, so a nested workspace beats its parent.
		.sort((a, b) => longestFolder(b) - longestFolder(a))[0];
	if (byFolder) return byFolder;

	const declared = input.frontmatter?.workspace;
	if (typeof declared === 'string') {
		return workspaces.find((w) => w.slug === declared) ?? null;
	}

	if (input.text) {
		const words = displayText(input.text);
		const byAlias = workspaces.find((w) => w.aliases.some((alias) => mentions(words, alias)));
		if (byAlias) return byAlias;
	}
	return null;
}

/** Whole-word, case-insensitive, and blind to regex metacharacters. */
function mentions(text: string, alias: string): boolean {
	let pattern = ALIAS_PATTERNS.get(alias);
	if (!pattern) {
		const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		// Word characters rather than `\b`, so an alias ending in punctuation
		// (`c++`) still matches and `Kaya` still refuses `Kayak`.
		pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i');
		ALIAS_PATTERNS.set(alias, pattern);
	}
	return pattern.test(text);
}

/** Compiled once per alias: attribution runs over every block of a week. */
const ALIAS_PATTERNS = new Map<string, RegExp>();

/**
 * The workspace's home folder: where its `Tasks.md`, `Inbox.md`, `Log.md`,
 * `Deals.md` and `Pages/` live. The first folder a workspace names, so a
 * workspace with several folders still has one unambiguous place for the
 * files only it writes; `Inbox` for one that names none yet.
 */
export function homeFolder(workspace: Workspace): string {
	return workspace.folders[0] ?? 'Inbox';
}

/**
 * Write the starting set of workspaces into a vault that has none.
 *
 * All or nothing, deliberately. Seeding file by file would add a stray
 * workspace whenever the shipped defaults changed, littering the vault of
 * someone who had already set their own up.
 */
export async function seedWorkspaces(vault: Vault): Promise<string[]> {
	const existing = (await vault.list()).filter((p) => p.startsWith(`${WORKSPACE_DIR}/`));
	if (existing.length > 0) return [];

	const written: string[] = [];
	for (const seed of SEEDS) {
		const result = await vault.write(`${WORKSPACE_DIR}/${seed.slug}.md`, renderWorkspace(seed));
		if (result.ok) written.push(result.note.path);
	}
	return written;
}

function toWorkspace(path: string, fm: Record<string, unknown>): Workspace {
	const slug = (path.split('/').pop() ?? '').replace(/\.md$/, '');
	const folders = strList(fm.folders);
	const stages = strList(fm.stages).map((s) => s.trim()).filter(Boolean);
	return {
		slug,
		name: str(fm.name) ?? slug,
		color: str(fm.color) ?? '#6b7280',
		tag: str(fm.tag) ?? `ws/${slug}`,
		aliases: strList(fm.aliases).map((a) => a.trim()).filter(Boolean),
		folders,
		template: str(fm.template) ?? undefined,
		stages: stages.length ? stages : [...DEFAULT_STAGES],
		path
	};
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strList(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function longestFolder(w: Workspace): number {
	return Math.max(0, ...w.folders.map((f) => f.length));
}

interface Seed extends Omit<Workspace, 'path' | 'aliases' | 'stages'> {
	description: string;
	/** Absent in every shipped seed: a name is not an alias until you say so. */
	aliases?: string[];
}

export type NewWorkspace = {
	name: string;
	color?: string;
	folders?: string[];
};

export type WorkspaceCreated =
	| { ok: true; workspace: Workspace }
	| { ok: false; reason: 'no-name' | 'exists' };

/**
 * Create one workspace file from the wizard.
 *
 * Refuses rather than overwrites when the slug is taken, because a workspace
 * file is the user's own document and silently replacing one would lose
 * whatever the user had already put in it.
 */
export async function createWorkspace(vault: Vault, spec: NewWorkspace): Promise<WorkspaceCreated> {
	const slug = slugify(spec.name ?? '');
	if (!slug) return { ok: false, reason: 'no-name' };

	const path = `${WORKSPACE_DIR}/${slug}.md`;
	if ((await vault.read(path)).exists) return { ok: false, reason: 'exists' };

	const seed: Seed = {
		slug,
		name: spec.name.trim(),
		color: spec.color ?? '#6b7280',
		tag: `ws/${slug}`,
		folders: (spec.folders ?? []).map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean),
		description: `Created from the hub. Point \`folders\` at wherever its notes live.`
	};
	const result = await vault.write(path, renderWorkspace(seed));
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, workspace: toWorkspace(path, parseNote(result.note.content, path).frontmatter) };
}

/**
 * The starting set, written once into a vault that has none. They are meant to
 * be edited or deleted: the point is that a new user sees the shape of a
 * workspace file rather than an empty folder. Real workspaces live in the
 * vault, not in this source file.
 */
const SEEDS: Seed[] = [
	{
		slug: 'work',
		name: 'Work',
		color: '#2f6fed',
		tag: 'ws/work',
		folders: ['Work'],
		description: 'The day job. Point `folders` at wherever its notes live.'
	},
	{
		slug: 'study',
		name: 'Study',
		color: '#7c3aed',
		tag: 'ws/study',
		template: 'study',
		folders: ['Study'],
		description: 'Courses, books and whatever you are learning now.'
	},
	{
		slug: 'personal',
		name: 'Personal',
		color: '#16a34a',
		tag: 'ws/personal',
		folders: ['Inbox'],
		description: 'Habits, reading, everything outside work.'
	},
	{
		slug: 'side-projects',
		name: 'Side projects',
		color: '#ea580c',
		tag: 'ws/side',
		folders: ['Projects'],
		description: 'Things you build on your own time.'
	}
];

/** A workspace file a human can read and edit in Obsidian. */
function renderWorkspace(seed: Seed): string {
	const folders = seed.folders.map((f) => `  - ${JSON.stringify(f)}`).join('\n');
	// Written only when there is one to write, like every other optional marker
	// this app produces: an empty `aliases:` in a file the user opens in
	// Obsidian is a question they never asked.
	const aliases = seed.aliases?.length
		? `aliases:\n${seed.aliases.map((a) => `  - ${JSON.stringify(a)}`).join('\n')}\n`
		: '';
	const template = seed.template ? `template: ${seed.template}\n` : '';
	return `---
name: ${seed.name}
color: "${seed.color}"
tag: ${seed.tag}
${template}folders:
${folders}
${aliases}---

${seed.description}

Edit this file to change the workspace: its name, colour, tag and which
folders belong to it. Add a \`stages:\` list to change the deal pipeline from
the default (lead, proposal, negotiation, won, lost).
`;
}

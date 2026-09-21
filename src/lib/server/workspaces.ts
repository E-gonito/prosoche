/**
 * Workspaces: the modular tabs that divide a vault into the areas of a life,
 * such as work, study and personal.
 *
 * A workspace is one markdown file in `_hub/workspaces/`, so it is editable in
 * Obsidian and travels with the vault. Its frontmatter names the workspace,
 * where its notes live, and which widgets appear on which tab. The widget
 * catalogue itself is rendered in phase 2; this module only reads and writes
 * the definitions, and answers the one question everything else needs: does
 * this note or task belong to this workspace?
 */

import { parseNote } from './parse/note';
import { slugify } from '$lib/shared/slug';
import { config } from './config';
import type { Vault } from './vault/index';

export interface WorkspaceTab {
	title: string;
	/** Widget names from the catalogue, e.g. `board`, `topic-map`. */
	widgets: string[];
}

export interface Workspace {
	/** Derived from the file name, e.g. `_hub/workspaces/study.md` -> `study`. */
	slug: string;
	name: string;
	color: string;
	/** Tag that assigns a task to this workspace, without the `#`. */
	tag: string;
	folders: string[];
	template: string;
	tabs: WorkspaceTab[];
	/** Note new cards are appended to when the board has nowhere better. */
	deck: string;
	/** Board column titles. Empty means the five task statuses. */
	kanbanColumns: string[];
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
 * fixes: explicit tag, then containing folder, then a `workspace:` field.
 * Returns null for anything unassigned rather than guessing.
 */
export function workspaceFor(
	workspaces: Workspace[],
	input: { path: string; tags?: string[]; frontmatter?: Record<string, unknown> }
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
	return null;
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
	return {
		slug,
		name: str(fm.name) ?? slug,
		color: str(fm.color) ?? '#6b7280',
		tag: str(fm.tag) ?? `ws/${slug}`,
		folders: strList(fm.folders),
		template: str(fm.template) ?? 'project',
		tabs: toTabs(fm.tabs),
		deck: str(fm.deck) ?? `${strList(fm.folders)[0] ?? 'Inbox'}/Tasks.md`,
		kanbanColumns: strList(fm.kanban_columns),
		path
	};
}

function toTabs(value: unknown): WorkspaceTab[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (typeof entry !== 'object' || entry === null) return null;
			const tab = entry as Record<string, unknown>;
			const title = str(tab.title);
			if (!title) return null;
			return { title, widgets: strList(tab.widgets) };
		})
		.filter((t): t is WorkspaceTab => t !== null);
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

interface Seed extends Omit<Workspace, 'path' | 'deck' | 'kanbanColumns'> {
	description: string;
}

export type NewWorkspace = {
	name: string;
	color?: string;
	folders?: string[];
	template?: string;
};

export type WorkspaceCreated =
	| { ok: true; workspace: Workspace }
	| { ok: false; reason: 'no-name' | 'exists' };

/**
 * Create one workspace file from the wizard.
 *
 * Refuses rather than overwrites when the slug is taken, because a workspace
 * file is the user's own document and silently replacing one would lose the
 * tabs they had arranged. The tabs come from the named template, or from
 * `project` when the name is not one this version knows.
 */
export async function createWorkspace(vault: Vault, spec: NewWorkspace): Promise<WorkspaceCreated> {
	const slug = slugify(spec.name ?? '');
	if (!slug) return { ok: false, reason: 'no-name' };

	const path = `${WORKSPACE_DIR}/${slug}.md`;
	if ((await vault.read(path)).exists) return { ok: false, reason: 'exists' };

	const template = spec.template && TEMPLATE_TABS[spec.template] ? spec.template : 'project';
	const seed: Seed = {
		slug,
		name: spec.name.trim(),
		color: spec.color ?? '#6b7280',
		tag: `ws/${slug}`,
		folders: (spec.folders ?? []).map((f) => f.replace(/^\/+|\/+$/g, '')).filter(Boolean),
		template,
		tabs: [...TEMPLATE_TABS[template]],
		description: `Created from the hub. Point \`folders\` at wherever its notes live.`
	};
	const result = await vault.write(path, renderWorkspace(seed));
	if (!result.ok) return { ok: false, reason: 'exists' };
	return { ok: true, workspace: toWorkspace(path, parseNote(result.note.content, path).frontmatter) };
}

/**
 * What each template starts a workspace with. Exported so the new-workspace
 * form can describe a template accurately instead of repeating the list in
 * prose that drifts.
 */
export const TEMPLATE_TABS: Record<string, WorkspaceTab[]> = {
	project: [
		{ title: 'Board', widgets: ['board'] },
		{ title: 'Notes', widgets: ['notes'] },
		{ title: 'People', widgets: ['people'] },
		{ title: 'Blocked', widgets: ['blocked'] },
		{ title: 'Time', widgets: ['time'] },
		{ title: 'Insights', widgets: ['insights'] }
	],
	business: [
		{ title: 'Board', widgets: ['board'] },
		{ title: 'Notes', widgets: ['notes'] },
		{ title: 'People', widgets: ['people'] },
		{ title: 'Blocked', widgets: ['blocked'] },
		{ title: 'Insights', widgets: ['insights'] }
	],
	study: [
		{ title: 'Overview', widgets: ['currently-learning', 'queue', 'flashcards-due', 'topic-map'] },
		{ title: 'Board', widgets: ['board'] },
		{ title: 'Notes', widgets: ['notes'] },
		{ title: 'Insights', widgets: ['insights'] }
	],
	area: [
		{ title: 'Dashboard', widgets: ['habits', 'currently-learning', 'topic-map'] },
		{ title: 'Board', widgets: ['board'] },
		{ title: 'Notes', widgets: ['notes'] },
		{ title: 'Insights', widgets: ['insights'] }
	]
};

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
		template: 'project',
		tabs: [...TEMPLATE_TABS.project],
		description: 'The day job. Point `folders` at wherever its notes live.'
	},
	{
		slug: 'study',
		name: 'Study',
		color: '#7c3aed',
		tag: 'ws/study',
		folders: ['Study'],
		template: 'study',
		tabs: [...TEMPLATE_TABS.study],
		description: 'Courses, books and whatever you are learning now.'
	},
	{
		slug: 'personal',
		name: 'Personal',
		color: '#16a34a',
		tag: 'ws/personal',
		folders: ['Inbox'],
		template: 'area',
		tabs: [...TEMPLATE_TABS.area],
		description: 'Habits, reading, everything outside work.'
	},
	{
		slug: 'side-projects',
		name: 'Side projects',
		color: '#ea580c',
		tag: 'ws/side',
		folders: ['Projects'],
		template: 'project',
		tabs: [...TEMPLATE_TABS.project],
		description: 'Things you build on your own time.'
	}
];

/** A workspace file a human can read and edit in Obsidian. */
function renderWorkspace(seed: Seed): string {
	const tabs = seed.tabs
		.map((tab) => `  - title: ${tab.title}\n    widgets: [${tab.widgets.join(', ')}]`)
		.join('\n');
	const folders = seed.folders.map((f) => `  - ${JSON.stringify(f)}`).join('\n');
	return `---
name: ${seed.name}
color: "${seed.color}"
tag: ${seed.tag}
template: ${seed.template}
folders:
${folders}
tabs:
${tabs}
---

${seed.description}

Edit this file to change the workspace. Tabs are lists of widgets from the
catalogue: board, notes, people, blocked, time, insights, pinned, habits,
currently-learning, queue, topic-map, flashcards-due, timesheet, inbox.
`;
}

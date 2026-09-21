/**
 * Topics and the coverage map: what the user is trying to learn, and which
 * parts of it nothing is pointing at.
 *
 * The specification assumed `Computer Science/Topics/<topic>.md`, one note per
 * curriculum node with a `parent:` field. That folder does not exist and no
 * note in the vault declares a parent. What the user actually has is a folder
 * tree — `Computer Science/Networking`, `.../Data Structures` — and syllabus
 * notes such as `CS/Course/Course Syllabus.md`, which is six `####`
 * headings over forty-four checkboxes. So a topic here comes from one of three
 * places, in decreasing order of how much the user had to do to create it:
 *
 *  - `declared`: a note whose frontmatter says `type: topic`, optionally with
 *    `parent:`. Nothing in the vault uses this yet; it is supported so the
 *    user can adopt it one note at a time rather than all at once.
 *  - `heading`: a syllabus note and each of its headings that carries
 *    checkboxes, which gives the map real progress numbers for free.
 *  - `folder`: every folder in scope. This is what makes a map exist at all
 *    in a vault that has never written a topic note.
 *
 * This module also owns the three things every other study module needs about
 * where something sits: is this path in scope, what is this name's id, and one
 * shared sweep of the notes so a dashboard of five widgets reads the vault
 * once rather than five times.
 */

import { basename, parseNote, type Heading, type ParsedNote } from '../parse/note';
import { isDone, type Task } from '$lib/shared/task';
import type { Card, Resource, StudyScope, Topic, TopicCoverage } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';

export type { Topic, TopicCoverage };

/**
 * Folders deeper than this below the top of the scope stop being topics.
 * `Computer Science/Courses/IBM AI Engineering/Resources` is a filing detail,
 * not a subject, and a map that shows it is a file tree with a new name.
 */
const MAX_DEPTH = 3;

/** Checkboxes a note needs before its headings are treated as a curriculum. */
const MIN_SYLLABUS_ITEMS = 4;

/**
 * Every topic in scope, parents before children.
 *
 * Reads notes for their frontmatter and headings and the index for their
 * checkboxes. Never writes. A scope with no folders and no tags is the whole
 * vault, so the same call serves a workspace tab and the global study page.
 */
export async function topicsIn(vault: Vault, index: NoteIndex, scope?: StudyScope): Promise<Topic[]> {
	const paths: string[] = [];
	const extra: Topic[] = [];

	for (const { path, parsed } of await scopedNotes(vault, scope)) {
		paths.push(path);

		if (parsed.frontmatter.type === 'topic') {
			extra.push({
				id: slug(parsed.title),
				name: parsed.title,
				parent: typeof parsed.frontmatter.parent === 'string' ? slug(parsed.frontmatter.parent) : null,
				path,
				kind: 'declared',
				notes: 1,
				done: 0,
				total: 0
			});
			continue;
		}
		extra.push(...syllabusTopics(path, parsed.title, parsed.headings, index.tasksIn(path)));
	}

	const folders = folderTopics(paths);
	const known = new Set(folders.map((t) => t.id));
	// A declared or syllabus topic naming a parent that is not there hangs off
	// the root rather than vanishing, because a typo should be visible.
	return [...folders, ...extra.map((t) => (t.parent && !known.has(t.parent) && !extra.some((o) => o.id === t.parent) ? { ...t, parent: null } : t))];
}

/**
 * The folder tree of a set of note paths, as topics.
 *
 * Pure. `notes` counts everything below a folder, not just its own files, so a
 * parent topic is never reported as empty because its notes are one level
 * down. Folders more than `MAX_DEPTH` deep are folded into their ancestor.
 */
export function folderTopics(paths: string[]): Topic[] {
	const counts = new Map<string, number>();
	for (const path of paths) {
		const parts = path.split('/').slice(0, -1).slice(0, MAX_DEPTH);
		for (let i = 0; i < parts.length; i++) {
			const folder = parts.slice(0, i + 1).join('/');
			counts.set(folder, (counts.get(folder) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([folder, notes]) => {
			const parent = folder.split('/').slice(0, -1).join('/');
			return {
				id: slug(folder),
				name: folder.split('/').pop() ?? folder,
				parent: parent ? slug(parent) : null,
				path: folder,
				kind: 'folder' as const,
				notes,
				done: 0,
				total: 0
			};
		});
}

/**
 * A syllabus note and its headings, as topics with checklist progress.
 *
 * Pure. Returns nothing unless the note holds at least `MIN_SYLLABUS_ITEMS`
 * checkboxes, which is what keeps every note with a to-do list in it out of
 * the topic map, and only headings that carry checkboxes become topics.
 */
export function syllabusTopics(path: string, title: string, headings: Heading[], tasks: Task[]): Topic[] {
	const items = tasks.filter((t) => !t.fenced);
	if (items.length < MIN_SYLLABUS_ITEMS) return [];

	const noteId = slug(path.replace(/\.md$/, ''));
	const folder = path.split('/').slice(0, -1).join('/');
	const root: Topic = {
		id: noteId,
		name: title === 'Untitled' ? basename(path) : title,
		parent: folder ? slug(folder) : null,
		path,
		kind: 'heading',
		notes: 1,
		done: items.filter(isDone).length,
		total: items.length
	};

	const sections = headings.map((h) => ({ heading: h, items: [] as Task[] }));
	for (const item of items) {
		const owner = [...sections].reverse().find((s) => s.heading.line < item.line);
		if (owner) owner.items.push(item);
	}

	return [
		root,
		...sections
			.filter((s) => s.items.length > 0)
			.map(({ heading, items: own }) => ({
				id: slug(`${noteId}/${heading.text}`),
				name: heading.text,
				parent: noteId,
				path,
				kind: 'heading' as const,
				notes: 0,
				done: own.filter(isDone).length,
				total: own.length
			}))
	];
}

/**
 * What is covering each topic: resources pointed at it, and cards drawn from
 * it. Pure, so the same call serves the widget, the page and a test.
 *
 * A resource belongs to a topic when it names the topic's id in `topics:` or
 * when it lives under the topic's folder. A card belongs when its note does.
 * Counts therefore roll up: a parent folder is covered by anything covering
 * its children, which is what makes the map readable at the top level.
 *
 * `gap` is the answer the map exists for: a topic with neither a resource nor
 * a card, and no checklist progress of its own.
 */
export function coverage(topics: Topic[], resources: Resource[], cards: Card[], on?: string): TopicCoverage[] {
	return topics.map((topic) => {
		const mine = resources.filter((r) => belongs(r.path, r.topics, topic));
		const own = cards.filter((c) => belongs(c.path, [], topic));
		const started = mine.filter((r) => r.status === 'learning' || r.status === 'done').length;
		const cardsDue = on ? own.filter((c) => !c.schedule || c.schedule.due <= on).length : 0;
		const touched = mine.length > 0 || own.length > 0 || topic.done > 0;
		return {
			...topic,
			resources: mine.length,
			started,
			cards: own.length,
			cardsDue,
			state: mine.length > 0 && own.length > 0 ? 'covered' : touched ? 'started' : 'gap'
		};
	});
}

/**
 * Whether a note belongs to a scope. An empty scope is the whole vault, which
 * is what a page with no workspace wants. A tag matches nested tags too, so
 * `ws/personal` covers `ws/personal/reading`.
 */
export function inScope(path: string, tags: string[], scope: StudyScope | undefined): boolean {
	const folders = scope?.folders ?? [];
	const wanted = scope?.tags ?? [];
	if (!folders.length && !wanted.length) return true;
	if (folders.some((f) => path === f || path.startsWith(`${f.replace(/\/$/, '')}/`))) return true;
	return wanted.some((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)));
}

/**
 * The scope a workspace implies: its folders and its tag.
 *
 * Takes the two fields rather than a `Workspace`, so the study modules stay
 * independent of the workspace file format, and null — a page with no
 * workspace — means the whole vault. This is the one place the study section
 * turns "which tab am I on" into "which notes do I read", which is what lets
 * the same five widgets sit on the study page and on a workspace dashboard.
 */
export function scopeOf(workspace: { folders: string[]; tag: string } | null): StudyScope {
	if (!workspace) return {};
	return { folders: workspace.folders, tags: workspace.tag ? [workspace.tag] : [] };
}

/** One note, read and parsed once, as the study modules want it. */
export interface ScopedNote {
	path: string;
	content: string;
	mtimeMs: number;
	parsed: ParsedNote;
}

/**
 * Every note in scope, read and parsed, from one sweep of the vault.
 *
 * Review state, resource status and topics all live in the markdown, and the
 * index holds none of them, so each of those questions means reading the
 * notes. A dashboard asks all three at once. This reads the vault once per
 * change instead, keyed by the vault it was given and thrown away the moment
 * anything in that vault changes, so a widget can never show what a file said
 * a second ago.
 *
 * Never writes. A note that disappears between listing and reading is skipped
 * rather than reported.
 */
export async function scopedNotes(vault: Vault, scope?: StudyScope): Promise<ScopedNote[]> {
	let entry = sweeps.get(vault);
	if (!entry) {
		entry = { pending: null };
		sweeps.set(vault, entry);
		vault.subscribe(() => {
			entry!.pending = null;
		});
	}
	entry.pending ??= sweep(vault);
	return (await entry.pending).filter((n) => inScope(n.path, n.parsed.tags, scope));
}

const sweeps = new WeakMap<Vault, { pending: Promise<ScopedNote[]> | null }>();

async function sweep(vault: Vault): Promise<ScopedNote[]> {
	const notes: ScopedNote[] = [];
	for (const path of await vault.list()) {
		if (path.startsWith('_hub/')) continue;
		const note = await vault.read(path);
		if (!note.exists) continue;
		notes.push({ path, content: note.content, mtimeMs: note.mtimeMs, parsed: parseNote(note.content, path) });
	}
	return notes;
}

/** A name or path reduced to a stable topic id. */
export function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9/]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-*\/-*/g, '/');
}

function belongs(path: string, topics: string[], topic: Topic): boolean {
	if (topics.includes(topic.id)) return true;
	if (!topic.path) return false;
	return topic.path.endsWith('.md') ? path === topic.path : path.startsWith(`${topic.path}/`);
}

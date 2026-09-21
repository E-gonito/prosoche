/**
 * Resources: the articles, courses, books and videos the user is working
 * through, and the queue of what to start next.
 *
 * The specification described a resource as a note with
 * `type/kind/url/status/progress/topics` frontmatter under
 * a dedicated `Resources/` folder. No vault this was written against had one.
 * What they have instead is resource notes scattered through the subject
 * folders, whose frontmatter is a single `media_link:` and whose body starts
 * with a `#Video` tag; some are a bare link and some are full notes.
 * So this module reads what is there, infers the two fields the vault does
 * not state, and writes `status:` only when the user asks it to — one line,
 * into notes they have actually touched, never as a bulk migration.
 *
 * Inference is deliberately conservative and always visible: a resource says
 * whether its status was stated or guessed, so the widget can show the guess
 * as a guess and one click turns it into a fact.
 */

import { basename, parseNote } from '../parse/note';
import { isDone } from '$lib/shared/task';
// `topics.ts` owns the two questions about where a note sits, so scope and id
// mean exactly one thing across the study section.
import { scopedNotes, slug } from './topics';
import type { Resource, ResourceKind, ResourceStatus, StudyScope, TopicCoverage } from '$lib/shared/study';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';

export type { Resource, ResourceKind, ResourceStatus };

const STATUSES: ResourceStatus[] = ['queued', 'learning', 'paused', 'done'];
const KINDS: ResourceKind[] = ['course', 'book', 'article', 'video', 'lab', 'paper', 'note'];

/** Frontmatter keys that hold a link, in the order they are believed. */
const URL_KEYS = ['url', 'media_link', 'link'];

/**
 * How much prose a note must hold before it counts as started.
 *
 * The stub resource notes in this vault are 95 bytes: frontmatter, a link and
 * `#Video`. The ones the user has watched run to a thousand words of their own
 * writing. Eighty characters of prose separates the two cleanly, and being
 * wrong only means a status the user can correct with one click.
 */
const STARTED_CHARS = 80;

/**
 * Every resource in scope, most recently touched first.
 *
 * Reads the notes themselves rather than the index, because status and
 * progress are inferred from the body and the index stores neither. Never
 * writes. A note that cannot be parsed is skipped, not reported as an error.
 */
export async function resources(vault: Vault, index: NoteIndex, scope?: StudyScope): Promise<Resource[]> {
	const out: Resource[] = [];
	for (const { path, mtimeMs, parsed } of await scopedNotes(vault, scope)) {
		if (!isResource(path, parsed.frontmatter, parsed.tags)) continue;

		const tasks = index.tasksIn(path).filter((t) => !t.fenced);
		out.push(
			toResource({
				path,
				title: parsed.title === 'Untitled' ? basename(path) : parsed.title,
				frontmatter: parsed.frontmatter,
				tags: parsed.tags,
				body: parsed.body,
				updatedMs: mtimeMs,
				tasksDone: tasks.filter(isDone).length,
				tasksTotal: tasks.length
			})
		);
	}
	return out.sort((a, b) => b.updatedMs - a.updatedMs);
}

/**
 * What to read or watch next, best first.
 *
 * The rule, stated so it can be argued with rather than reverse-engineered:
 *
 *  1. Finish what you started. Anything `learning` outranks anything `queued`;
 *     `paused` and `done` are not in the queue at all.
 *  2. Then fill the biggest hole. A resource whose topics have no other
 *     resource and no flashcards comes before one piling onto a covered topic.
 *  3. Then oldest first, by `added:` if stated and by the file's own age
 *     otherwise, so the read-later pile drains instead of growing.
 *  4. Then by title, so the order never shuffles between two page loads.
 *
 * Pure. `coverage` may be empty, in which case rule 2 simply does nothing.
 */
export function queue(all: Resource[], coverage: TopicCoverage[] = []): Resource[] {
	const gaps = new Map(coverage.map((c) => [c.id, c.state === 'gap' ? 0 : c.state === 'started' ? 1 : 2]));
	const need = (r: Resource) => Math.min(2, ...r.topics.map((t) => gaps.get(t) ?? 2), 2);
	const rank = (r: Resource) => (r.status === 'learning' ? 0 : 1);
	const age = (r: Resource) => r.added ?? new Date(r.updatedMs).toISOString().slice(0, 10);

	return all
		.filter((r) => r.status === 'queued' || r.status === 'learning')
		.sort(
			(a, b) =>
				rank(a) - rank(b) ||
				need(a) - need(b) ||
				age(a).localeCompare(age(b)) ||
				a.title.localeCompare(b.title)
		);
}

export type StatusWritten =
	| { ok: true; resource: Resource }
	| { ok: false; reason: 'no-note' | 'conflict' | 'bad-status' };

/**
 * Record a resource's status in its own frontmatter.
 *
 * The one thing the hub writes to a resource note, and it writes one line:
 * an existing `status:` is replaced where it stands, a missing one is inserted
 * at the end of the frontmatter block, and a note with no frontmatter gains a
 * three-line one at the top. The body is never touched and the note is never
 * re-serialised from a parsed model, so comments, ordering and odd spacing in
 * the frontmatter survive.
 */
export async function setStatus(
	vault: Vault,
	index: NoteIndex,
	path: string,
	status: ResourceStatus
): Promise<StatusWritten> {
	if (!STATUSES.includes(status)) return { ok: false, reason: 'bad-status' };
	const note = await vault.read(path);
	if (!note.exists) return { ok: false, reason: 'no-note' };

	const written = await vault.write(path, writeField(note.content, 'status', status), note.hash);
	if (!written.ok) return { ok: false, reason: 'conflict' };

	const parsed = parseNote(written.note.content, path);
	const tasks = index.tasksIn(path).filter((t) => !t.fenced);
	return {
		ok: true,
		resource: toResource({
			path,
			title: parsed.title === 'Untitled' ? basename(path) : parsed.title,
			frontmatter: parsed.frontmatter,
			tags: parsed.tags,
			body: parsed.body,
			updatedMs: written.note.mtimeMs,
			tasksDone: tasks.filter(isDone).length,
			tasksTotal: tasks.length
		})
	};
}

/**
 * `content` with one frontmatter field set, as a string transform.
 *
 * Pure, and byte-preserving everywhere but the one line it changes: this is
 * the whole reason the hub can write to a note the user also edits in
 * Obsidian. A file whose frontmatter fence is never closed is treated as
 * having none, so a half-typed note gains a field rather than being mangled.
 */
export function writeField(content: string, key: string, value: string): string {
	const lines = content.split('\n');
	const close = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;

	if (close === -1) return `---\n${key}: ${value}\n---\n${content}`;

	const at = lines.findIndex((l, i) => i > 0 && i < close && new RegExp(`^${key}\\s*:`).test(l));
	if (at === -1) lines.splice(close, 0, `${key}: ${value}`);
	else lines[at] = `${key}: ${value}`;
	return lines.join('\n');
}

/**
 * Whether a note is a resource.
 *
 * Four ways in, in the order they are trusted: it says `type: resource`; it
 * carries a link field; it is tagged with a kind such as `#Video`; or its file
 * name starts with a kind, which is this vault's `Video. <title>.md`
 * convention. The middle two are what the real vault uses today.
 */
export function isResource(path: string, frontmatter: Record<string, unknown>, tags: string[]): boolean {
	if (frontmatter.type === 'resource') return true;
	if (URL_KEYS.some((k) => typeof frontmatter[k] === 'string')) return true;
	if (tags.some((t) => KINDS.includes(t.toLowerCase() as ResourceKind))) return true;
	return kindFromName(path) !== null;
}

interface RawResource {
	path: string;
	title: string;
	frontmatter: Record<string, unknown>;
	tags: string[];
	body: string;
	updatedMs: number;
	tasksDone: number;
	tasksTotal: number;
}

/** Everything inferred about a resource, in one place. Pure. */
export function toResource(raw: RawResource): Resource {
	const fm = raw.frontmatter;
	const tasksTotal = raw.tasksTotal;
	const stated = STATUSES.includes(fm.status as ResourceStatus);
	const prose = proseLength(raw.body);

	const status: ResourceStatus = stated
		? (fm.status as ResourceStatus)
		: raw.tags.includes('done') || (tasksTotal > 0 && raw.tasksDone === tasksTotal)
			? 'done'
			: prose >= STARTED_CHARS || raw.tasksDone > 0
				? 'learning'
				: 'queued';

	const progress =
		typeof fm.progress === 'number'
			? clamp(fm.progress)
			: tasksTotal > 0
				? Math.round((raw.tasksDone / tasksTotal) * 100)
				: status === 'done'
					? 100
					: status === 'learning'
						? 50
						: 0;

	return {
		path: raw.path,
		title: raw.title,
		kind: kindOf(raw.path, fm, raw.tags),
		url: URL_KEYS.map((k) => fm[k]).find((v): v is string => typeof v === 'string') ?? firstLink(raw.body),
		status,
		stated,
		progress,
		topics: topicsOf(raw.path, fm),
		added: typeof fm.added === 'string' ? fm.added : null,
		updatedMs: raw.updatedMs,
		tasksDone: raw.tasksDone,
		tasksTotal
	};
}

/** Stated kind, then a kind tag, then the `Video. ` style file name prefix. */
function kindOf(path: string, fm: Record<string, unknown>, tags: string[]): ResourceKind {
	if (KINDS.includes(fm.kind as ResourceKind)) return fm.kind as ResourceKind;
	const tagged = tags.map((t) => t.toLowerCase()).find((t) => KINDS.includes(t as ResourceKind));
	if (tagged) return tagged as ResourceKind;
	return kindFromName(path) ?? 'note';
}

/** `Video. How to draw.md` is a video. Anything else here is not a kind. */
function kindFromName(path: string): ResourceKind | null {
	const prefix = basename(path).split('.')[0].trim().toLowerCase();
	return KINDS.includes(prefix as ResourceKind) ? (prefix as ResourceKind) : null;
}

/**
 * Topic ids for a resource: whatever `topics:` names, plus every folder it
 * lives in. The folders are what make the map work in a vault that has never
 * written a `topics:` line.
 */
function topicsOf(path: string, fm: Record<string, unknown>): string[] {
	const stated = Array.isArray(fm.topics) ? fm.topics.filter((t): t is string => typeof t === 'string') : [];
	const folders = path.split('/').slice(0, -1);
	const ids = new Set<string>();
	for (const t of stated) ids.add(slug(t));
	for (let i = 0; i < folders.length; i++) ids.add(slug(folders.slice(0, i + 1).join('/')));
	return [...ids];
}

/**
 * How much of the body is the user's own writing, ignoring the things a stub
 * note is made of: tags, bare links, embeds and whitespace.
 */
function proseLength(body: string): number {
	return body
		.replace(/!?\[\[[^\]]*\]\]/g, ' ')
		.replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/(^|\s)#[A-Za-z][\w/-]*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim().length;
}

function firstLink(body: string): string | null {
	return /https?:\/\/\S+/.exec(body)?.[0] ?? null;
}

function clamp(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

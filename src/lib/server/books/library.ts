/**
 * The books module routes call: list, open, add (a file or a URL), save the
 * place, add a highlight, remove. It joins a book's two halves, the note in
 * the vault (the author's reading, in git) and the files on the shelf (out
 * of git), and keeps each true to the other's rules: it never touches a path
 * itself, it asks the `Vault` and the `Shelf`.
 *
 * A note and its files are found to each other by the book's id only, never
 * by the note's file name, so the author may rename a note in Obsidian.
 * Either half may be missing: a note without files is `onShelf: false` and
 * "upload the file again"; files without a note get one when next added.
 *
 * Every id and place that arrives here from a request is checked here
 * (`isBookId`, `parsePlace`); a bad one reads as a book that is not there.
 */

import { randomBytes } from 'node:crypto';
import { config } from '../config';
import { today } from '../daily';
import type { NoteIndex } from '../index/index';
import type { Vault } from '../vault/index';
import type { Shelf } from '../vault/shelf';
import { fileId, isBookId, siteId } from './id';
import { ORIGINAL, readManifest, writeManifest } from './manifest';
import { addHighlight as addHighlightLine, newBookNote, readBookNote, setPlace, cleanQuote, type BookNote } from './note';
import { readPdf } from './pdf';
import { unpackEpub } from './epub';
import { saveSite, type SiteRefusal } from './site';
import { forgetBookText, queueText } from './search';
import { placeLabel, UPLOAD_TYPES, type BookManifest, type BookSummary, type Highlight, type Place } from '$lib/shared/books';

/** Why an upload was refused. */
export type UploadRefusal = 'bad-type' | 'too-large' | 'no-space' | 'bad-pdf' | 'bad-epub';

/** What adding a book answers: where its note is and whether the book was already known. */
export type Added =
	| { ok: true; id: string; note: string; title: string; existing: boolean }
	| { ok: false; reason: UploadRefusal | SiteRefusal['reason']; message: string };

const WORDS: Record<UploadRefusal, string> = {
	'bad-type': 'Only PDF and EPUB files can be added.',
	'too-large': `That file is over ${Math.round(config.books.maxBytes / 1024 / 1024)} MB.`,
	'no-space': 'The server is too full to take that. Remove a book first.',
	'bad-pdf': 'That does not open as a PDF.',
	'bad-epub': 'That does not open as an EPUB.'
};

/** A note in the books folder that is a book's. */
interface Found {
	path: string;
	content: string;
	hash: string;
	note: BookNote;
}

/** Every book note in the folder, sorted by file name. Never throws. */
async function notes(vault: Vault): Promise<Found[]> {
	const out: Found[] = [];
	for (const name of await vault.files(config.books.folder, 'md')) {
		const path = `${config.books.folder}/${name}`;
		const read = await vault.read(path);
		const note = read.exists ? readBookNote(read.content) : null;
		if (note) out.push({ path, content: read.content, hash: read.hash, note });
	}
	return out;
}

/** The note for a book id, or null. */
async function noteFor(vault: Vault, id: string): Promise<Found | null> {
	return isBookId(id) ? ((await notes(vault)).find((n) => n.note.id === id) ?? null) : null;
}

function summary(found: Found, manifest: BookManifest | null): BookSummary {
	const { note } = found;
	return {
		id: note.id,
		note: found.path,
		title: found.path.slice(found.path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
		format: note.format,
		source: note.source,
		at: note.at,
		atLabel: note.at ? placeLabel(note.at, manifest) : null,
		readAt: note.readAt,
		onShelf: manifest !== null,
		...(manifest ? { pages: manifest.pages, bytes: manifest.bytes, text: manifest.text } : {})
	};
}

/**
 * Every book that has a note under `config.books.folder` (its top level),
 * joined with its manifest on the shelf. Newest read first (`read_at`), the
 * never-read last, then by title. Never throws; a note that is not a book
 * note is not listed.
 */
export async function listBooks(vault: Vault, shelf: Shelf): Promise<BookSummary[]> {
	const books = await Promise.all((await notes(vault)).map(async (n) => summary(n, await readManifest(shelf, n.note.id))));
	return books.sort((a, b) => (a.readAt === b.readAt ? 0 : a.readAt === null ? 1 : b.readAt === null ? -1 : a.readAt < b.readAt ? 1 : -1) || a.title.localeCompare(b.title));
}

/**
 * One book: its summary, its manifest (null when its files are not on the
 * shelf) and the highlights in its note. Null for an id that is not valid or
 * has no note.
 */
export async function getBook(
	vault: Vault,
	shelf: Shelf,
	id: string
): Promise<{ book: BookSummary; manifest: BookManifest | null; highlights: Highlight[] } | null> {
	const found = await noteFor(vault, id);
	if (!found) return null;
	const manifest = await readManifest(shelf, id);
	return { book: summary(found, manifest), manifest, highlights: found.note.highlights };
}

/**
 * Add a book from an uploaded file. `body` is streamed to the shelf, never
 * held whole, under a temporary folder; its id is the hash of its bytes, so
 * the same file again is the same book (`existing`, and nothing is stored
 * twice). A new file's manifest is made from the PDF itself or the unpacked
 * EPUB; one they refuse leaves nothing on the shelf. Then the book's note is
 * found by id, or made as `Books/<Title>.md` (`ensureNote`), and the text is
 * queued for search unless it is already done.
 *
 * Refuses `bad-type` for any type but PDF and EPUB, `too-large` and
 * `no-space` as the shelf does, `bad-pdf` and `bad-epub` for a file that
 * will not open. Never throws for a bad upload.
 */
export async function addUpload(
	vault: Vault,
	shelf: Shelf,
	index: NoteIndex,
	file: { type: string; name: string; body: ReadableStream<Uint8Array> },
	now: Date
): Promise<Added> {
	const format = UPLOAD_TYPES[file.type.split(';')[0].trim().toLowerCase()];
	if (format !== 'pdf' && format !== 'epub') return refused('bad-type');
	const temp = `tmp-${randomBytes(4).toString('hex')}`;
	try {
		const put = await shelf.putStream(temp, ORIGINAL[format], file.body);
		if (!put.ok) return refused(put.reason);
		return await oneAtATime(() => finishUpload(vault, shelf, index, { format, name: file.name, temp, id: fileId(put.sha256) }, now));
	} finally {
		await shelf.remove(temp);
	}
}

/** Uploads finish one at a time, so the same file arriving twice is stored once. */
let finishing: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
	const run = finishing.then(work);
	finishing = run.catch(() => undefined);
	return run;
}

/** The part of `addUpload` after the bytes are on the shelf under `temp`: name them `id`, read them, make the note. */
async function finishUpload(
	vault: Vault,
	shelf: Shelf,
	index: NoteIndex,
	u: { format: 'pdf' | 'epub'; name: string; temp: string; id: string },
	now: Date
): Promise<Added> {
	const { format, temp, id } = u;
	let manifest = await readManifest(shelf, id);
	const isNew = manifest === null;
	if (manifest) await shelf.remove(temp);
	else {
		await shelf.rename(temp, id);
		const name = baseName(u.name);
		const stem = stemOf(name);
		const common = { id, format, source: name, scripts: false, text: { state: 'pending' } as const, savedAt: now.toISOString() };
		if (format === 'pdf') {
			const bytes = await shelf.read(id, ORIGINAL.pdf);
			const pdf = bytes ? await readPdf(bytes) : null;
			if (!pdf?.ok) {
				await shelf.remove(id);
				return refused('bad-pdf', pdf?.message);
			}
			manifest = { ...common, title: pdf.title ?? stem, bytes: 0, pages: pdf.pages, contents: pdf.contents };
		} else {
			const epub = await unpackEpub(shelf, id);
			if (!epub.ok) {
				await shelf.remove(id);
				return refused('bad-epub', epub.message);
			}
			manifest = { ...common, title: epub.title ?? stem, bytes: 0, chapters: epub.chapters, contents: epub.contents };
		}
		manifest.bytes = await shelf.size(id);
		await writeManifest(shelf, manifest);
	}
	const made = await ensureNote(vault, { id, format, title: manifest.title, source: manifest.source }, now);
	if (isNew || (manifest.text.state !== 'done' && manifest.text.state !== 'none')) queueText(shelf, index, id);
	return { ok: true, id, note: made.path, title: manifest.title, existing: made.existing };
}


/**
 * Add a book that is a website: save a copy of it (`saveSite`) under the id
 * its URL gives, and make its note if it has none. Adding it again replaces
 * the copy and queues its text again; the note, place and highlights stay.
 * A failed first save leaves nothing on the shelf, and a failed refresh
 * keeps the old copy.
 *
 * Refuses `bad-url` for anything that is not an http(s) address, and with
 * whatever `saveSite` refuses with.
 */
export async function addSite(vault: Vault, shelf: Shelf, index: NoteIndex, url: string, now: Date): Promise<Added> {
	const id = typeof url === 'string' ? siteId(url) : null;
	if (!id) return { ok: false, reason: 'bad-url', message: 'That is not a web address (http or https).' };
	const before = await readManifest(shelf, id);
	const saved = await saveSite(shelf, id, url.trim());
	if (!saved.ok) {
		if (!before) await shelf.remove(id);
		return { ok: false, reason: saved.reason, message: saved.message };
	}
	const manifest: BookManifest = {
		id,
		format: 'site',
		title: saved.title,
		source: url.trim(),
		bytes: await shelf.size(id),
		chapters: saved.chapters,
		contents: saved.contents,
		scripts: true,
		text: { state: 'pending' },
		savedAt: now.toISOString()
	};
	await writeManifest(shelf, manifest);
	const made = await ensureNote(vault, { id, format: 'site', title: saved.title, source: manifest.source }, now);
	queueText(shelf, index, id);
	return { ok: true, id, note: made.path, title: saved.title, existing: made.existing };
}

/**
 * Save where the author is: `at:` and `read_at:` in the book's note, nothing
 * else. Written against the hash it was read with; on a clash it reads
 * again and writes once more, because the place is the author's own latest
 * move and wins. Writes nothing when the note already says so.
 *
 * Refuses `not-found` for an id with no note and `conflict` when the second
 * try also clashes.
 */
export async function savePlace(vault: Vault, id: string, place: Place, now: Date): Promise<{ ok: true } | { ok: false; reason: 'not-found' | 'conflict' }> {
	return edit(vault, id, (content) => setPlace(content, place, today(now)));
}

/**
 * Add a highlight under `## Highlights` in the book's note (see
 * `addHighlight` in `note.ts` for how the line is written) and answer it as
 * the note now reads it. Retries once on a clash, since an added line does
 * not depend on the others.
 *
 * Refuses `no-text` for a quote with no words, `not-found` for an id with no
 * note and `conflict` when both tries clash.
 */
export async function addHighlight(
	vault: Vault,
	id: string,
	h: { quote: string; place: Place; comment?: string }
): Promise<{ ok: true; highlight: Highlight } | { ok: false; reason: 'not-found' | 'no-text' | 'conflict' }> {
	if (!cleanQuote(h.quote)) return { ok: false, reason: 'no-text' };
	let highlight: Highlight | undefined;
	const done = await edit(vault, id, (content) => {
		const next = addHighlightLine(content, h);
		highlight = readBookNote(next)?.highlights.at(-1);
		return next;
	});
	return done.ok && highlight ? { ok: true, highlight } : done.ok ? { ok: false, reason: 'not-found' } : done;
}

/**
 * Remove a book's files from the shelf and its text from the index. The note
 * stays, with its place and highlights, so adding the file again picks them
 * up. Removing a book that is not there is done.
 */
export async function removeBook(shelf: Shelf, index: NoteIndex, id: string): Promise<{ ok: true }> {
	if (isBookId(id)) {
		await shelf.remove(id);
		forgetBookText(index, id);
	}
	return { ok: true };
}

/** Rewrite a book's note through `change`, against the hash it was read with, trying twice. */
async function edit(vault: Vault, id: string, change: (content: string) => string): Promise<{ ok: true } | { ok: false; reason: 'not-found' | 'conflict' }> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const found = await noteFor(vault, id);
		if (!found) return { ok: false, reason: 'not-found' };
		const next = change(found.content);
		if (next === found.content) return { ok: true };
		const written = await vault.write(found.path, next, found.hash);
		if (written.ok) return { ok: true };
	}
	return { ok: false, reason: 'conflict' };
}

/** Notes are made one at a time so two uploads of one book make one note. */
let creating: Promise<unknown> = Promise.resolve();

/**
 * The book's note, found by id or made as `Books/<Title>.md`. The title has
 * the characters a file name cannot hold made `-` (`CS:APP` is `CS-APP`); a
 * name another file has gets ` (2)`, ` (3)`. `existing` says the note was
 * already there.
 */
function ensureNote(vault: Vault, book: { id: string; format: BookNote['format']; title: string; source: string }, now: Date): Promise<{ path: string; existing: boolean }> {
	const run = creating.then(async () => {
		const found = await noteFor(vault, book.id);
		if (found) return { path: found.path, existing: true };
		const title = fileName(book.title);
		let path = `${config.books.folder}/${title}.md`;
		for (let n = 2; (await vault.read(path)).exists; n++) path = `${config.books.folder}/${title} (${n}).md`;
		await vault.write(path, newBookNote({ id: book.id, format: book.format, source: book.source, added: today(now) }));
		return { path, existing: false };
	});
	creating = run.catch(() => undefined);
	return run;
}

/** A title as a file name: nothing Obsidian or Windows refuse, spaces collapsed, no edge dots, at most 120 characters. Pure. */
export function fileName(title: string): string {
	// eslint-disable-next-line no-control-regex
	const name = title.replace(/\s+/g, ' ').replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '-').trim().slice(0, 120).replace(/^[.\s]+|[.\s]+$/g, '');
	return name || 'Untitled book';
}

/** The last segment of an uploaded file's name. Pure. */
function baseName(name: string): string {
	return name.split(/[\\/]/).pop()?.trim() || 'book';
}

/** A file name without its extension. Pure. */
function stemOf(name: string): string {
	return name.replace(/\.[A-Za-z0-9]{1,5}$/, '') || name;
}

function refused(reason: UploadRefusal, message?: string): Added {
	return { ok: false, reason, message: message || WORDS[reason] };
}

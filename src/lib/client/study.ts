/**
 * The browser's side of the study API.
 *
 * Every call returns the same `Result` the task API returns, so a conflict is
 * something the page renders rather than something it catches. The shapes
 * these calls carry are in `$lib/shared/study`, and re-exported here so a
 * component needs one import rather than two.
 *
 * A call names its subject by slug and never by path: the server knows where
 * a subject's files are, and a page should not be choosing which file to
 * write.
 */

import type { Result, Task } from './api';
import type { Card, CardShift, Graded, ReadingList, ReadingOp } from '$lib/shared/study';
import type { Grade } from '$lib/shared/scheduler';
import type { DeckImport } from '$lib/shared/anki-import';

export * from '$lib/shared/study';
export type { Result, Task };

/**
 * Grade one card and write the new schedule into its note.
 *
 * Sends the line the browser last saw, so a card edited in Obsidian since the
 * page loaded is refused rather than overwritten. Returns the card with its
 * new schedule and its new `expectedRaw`, ready to be graded again, and the
 * shift to apply to any other card held from the same note.
 */
export async function gradeCard(card: Card, grade: Grade): Promise<Result<Graded>> {
	return post('/api/study/card', { ...locate(card), grade }, (body) => ({
		card: body.card as Card,
		shift: (body.shift ?? null) as CardShift | null
	}));
}

/**
 * Move a held queue on after a comment line was inserted into a note.
 *
 * A card's identity is its line number, and writing a schedule for a card that
 * never had one pushes every later card in that note down by one. Doing this
 * in the browser rather than reloading the queue is what keeps a session of
 * twenty cards from one note from refusing nineteen of them.
 *
 * Pure: returns a new list and never mutates the one it was given.
 */
export function applyShift(cards: Card[], shift: CardShift | null): Card[] {
	if (!shift) return cards;
	return cards.map((card) =>
		card.path === shift.path && card.line > shift.afterLine
			? {
					...card,
					line: card.line + shift.by,
					endLine: card.endLine + shift.by,
					scheduleLine: card.scheduleLine + shift.by
				}
			: card
	);
}

/**
 * Add a goal to a subject, appending its `## ` heading (and `target::` line,
 * if given) to its `Goals.md`. Creates the note when this is its first goal.
 */
export async function addGoal(subject: string, title: string, target: string | null): Promise<Result<void>> {
	return post('/api/study/goal', { subject, title, target }, () => undefined);
}

/**
 * Add a milestone under an existing goal, as a task line with the vault's own
 * `📅` due-date field. Returns the task, ready to be ticked like any other.
 */
export async function addMilestone(subject: string, heading: string, text: string, due: string | null): Promise<Result<Task>> {
	return post('/api/study/milestone', { subject, heading, text, due }, (body) => body.task as Task);
}

/**
 * Log a study session in a subject's `Sessions.md`, under its `## YYYY-MM`
 * heading, linked to `goal` when there is one.
 */
export async function logSession(
	subject: string,
	entry: { day: string; minutes: number; goal: string | null; note: string }
): Promise<Result<void>> {
	return post('/api/study/session', { subject, ...entry }, () => undefined);
}

/**
 * Apply one op to a subject's reading list. `hash` is the list's hash as the
 * page has it. Every answer but a lost connection carries the list as it now
 * is, so the page replaces what it shows with that and never has to guess.
 */
export async function changeReading(
	subject: string,
	hash: string,
	op: ReadingOp
): Promise<Result<ReadingList> | { ok: false; kind: 'conflict' | 'error'; message: string; list: ReadingList }> {
	try {
		const res = await fetch('/api/study/reading', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subject, hash, op })
		});
		const body = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: body.list };
		if (body.list) return { ok: false, kind: res.status === 409 ? 'conflict' : 'error', message: body.error ?? 'That did not work.', list: body.list };
		return { ok: false, kind: 'error', message: body.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection. Nothing was changed.' };
	}
}

/** Put a card file under a goal, or under none for null: one `goal:` line in its frontmatter. */
export async function setCardFileGoal(subject: string, path: string, goal: string | null): Promise<Result<void>> {
	return post('/api/study/card-file', { subject, path, goal }, () => undefined);
}

/** Create a subject homed at `Study/<name>`. Returns its slug, for the redirect. */
export async function createSubject(name: string, folders: string[]): Promise<Result<string>> {
	return post('/api/study/subject', { name, folders }, (body) => body.slug as string);
}

/**
 * Import the Anki decks under `Flashcards/`, writing a card file for each deck
 * that has none yet. Returns every deck with what happened to it; a file that
 * already existed is reported as `exists` and left exactly as it was.
 */
export async function importAnkiDecks(subject: string, sources: string[]): Promise<Result<DeckImport[]>> {
	return post('/api/study/import', { subject, sources }, (body) => body.decks as DeckImport[]);
}

/**
 * Which card this is, and the line the browser last saw.
 *
 * Deliberately not the schedule: the server reads that back out of the note,
 * so a stale or edited page cannot post a schedule of its own choosing. The
 * `expectedRaw` is a conflict token, not data the server trusts.
 */
function locate(card: Card) {
	return { path: card.path, line: card.line, index: card.index, expectedRaw: card.expectedRaw };
}

async function post<T>(url: string, body: unknown, pick: (body: any) => T): Promise<Result<T>> {
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, value: pick(parsed) };
		if (res.status === 409) {
			return { ok: false, kind: 'conflict', message: 'That changed in Obsidian or on another device.' };
		}
		return { ok: false, kind: 'error', message: parsed.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection.' };
	}
}

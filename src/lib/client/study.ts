/**
 * The browser's side of the study API.
 *
 * Every call returns the same `Result` the task API returns, so a conflict is
 * something the page renders rather than something it catches. The shapes
 * these calls carry are in `$lib/shared/study`, and re-exported here so a
 * component needs one import rather than two.
 */

import type { Result, Task } from './api';
import type { Card, CardShift, Graded, Resource, ResourceStatus, StudyScope } from '$lib/shared/study';
import type { Grade } from '$lib/shared/sm2';
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
 * Add a goal, appending its `## ` heading (and `target::` line, if given) to
 * `Goals.md`. Creates the note when this is its first goal.
 */
export async function addGoal(path: string, title: string, target: string | null): Promise<Result<void>> {
	return post('/api/study/goal', { path, title, target }, () => undefined);
}

/**
 * Add a milestone under an existing goal, as a task line with the vault's own
 * `📅` due-date field. Returns the task, ready to be ticked like any other.
 */
export async function addMilestone(
	path: string,
	heading: string,
	text: string,
	due: string | null
): Promise<Result<Task>> {
	return post('/api/study/milestone', { path, heading, text, due }, (body) => body.task as Task);
}

/** Log a study session, appended under its `## YYYY-MM` heading in `Sessions.md`. */
export async function logSession(
	path: string,
	entry: { day: string; minutes: number; topic: string | null; note: string }
): Promise<Result<void>> {
	return post('/api/study/session', { path, ...entry }, () => undefined);
}

/**
 * Set a resource's status, writing `status:` into its frontmatter.
 *
 * The only thing the hub ever writes to a resource note, and it writes one
 * line: an existing `status:` is replaced in place, a missing one is inserted
 * into the frontmatter block, and a note with no frontmatter gains one. The
 * body is never touched.
 */
export async function setResourceStatus(path: string, status: ResourceStatus): Promise<Result<Resource>> {
	return post('/api/study/resource', { path, status }, (body) => body.resource as Resource);
}

/** Where to point a link so the browser downloads an Anki deck of `cards`. */
export function ankiDeckUrl(scope: StudyScope, deck: string): string {
	const params = new URLSearchParams({ deck });
	for (const folder of scope.folders ?? []) params.append('folder', folder);
	for (const tag of scope.tags ?? []) params.append('tag', tag);
	return `/api/study/card?${params}`;
}

/**
 * Import the Anki decks under `Flashcards/`, writing a card file for each deck
 * that has none yet. Returns every deck with what happened to it; a file that
 * already existed is reported as `exists` and left exactly as it was.
 */
export async function importAnkiDecks(): Promise<Result<DeckImport[]>> {
	return post('/api/study/import', {}, (body) => body.decks as DeckImport[]);
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
			return { ok: false, kind: 'conflict', message: 'That card changed in Obsidian. Reloading.' };
		}
		return { ok: false, kind: 'error', message: parsed.error ?? `Request failed (${res.status})` };
	} catch {
		return { ok: false, kind: 'offline', message: 'No connection.' };
	}
}

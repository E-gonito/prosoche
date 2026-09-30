/**
 * The browser's side of reviewing flashcards: grading one card, and moving a
 * held queue on after a grade inserted a line.
 *
 * Every other study write is a plain `api` call; these two are named because
 * they locate a card and keep line numbers true.
 */

import { api, type Result } from './api';
import type { Card, CardShift, Graded } from '$lib/shared/study';
import type { Grade } from '$lib/shared/scheduler';

/**
 * Grade one card and write the new schedule into its note.
 *
 * Sends which card this is and the line the browser last saw, deliberately
 * not the schedule: the server reads that back out of the note, so a card
 * edited in Obsidian since the page loaded is refused rather than
 * overwritten, and a stale page cannot post a schedule of its own choosing.
 * Returns the card with its new schedule and its new `expectedRaw`, ready to
 * be graded again, and the shift to apply to any other card held from the
 * same note.
 */
export async function gradeCard(card: Card, grade: Grade): Promise<Result<Graded>> {
	const { path, line, index, expectedRaw } = card;
	const result = await api<{ card: Card; shift?: CardShift | null }>('/api/study/card', { path, line, index, expectedRaw, grade });
	return result.ok ? { ok: true, value: { card: result.value.card, shift: result.value.shift ?? null } } : result;
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

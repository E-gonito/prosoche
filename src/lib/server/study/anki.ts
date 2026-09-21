/**
 * Exporting cards to Anki.
 *
 * The user has eighty Anki decks under `Flashcards/`, all `.txt`, but does not
 * use Anki day to day any more: the markdown cards in the notes are the live
 * ones. So Anki is not a review app here, it is a way out, in case the user
 * ever wants their cards somewhere else.
 *
 * This module is a pure serialiser and nothing else. It returns a string; it
 * has no filesystem access and cannot acquire any, which is how "never writes
 * into the vault" is made structurally true rather than merely intended. The
 * route that calls it sends the text to the browser as a download, and the
 * existing `.txt` decks are never read, rewritten or deleted.
 *
 * The format is copied from the user's own exports, header and all:
 *
 *     #separator:Tab
 *     #html:true
 *     #deck:CS::Cyber Security
 *     #tags:CS Cyber Security
 *
 *     What is Bandit Level 1?<TAB>The password is …&lt;br&gt;1. cat ./-
 */

import type { Card } from '$lib/shared/study';

export interface AnkiDeck {
	/** Anki deck name, `::` separated, e.g. `CS::Networking`. */
	name: string;
	/** Tags applied to every card, space separated in the header. */
	tags?: string[];
}

/** File name a browser should save the export as. Never a path into the vault. */
export function ankiFilename(deck: string): string {
	return `${deck.replace(/::/g, ' - ').replace(/[^\w .-]+/g, '_') || 'flashcards'}.txt`;
}

/**
 * `cards` as an Anki-importable tab separated file.
 *
 * One card per line: question, a tab, answer. Newlines inside either side
 * become `&lt;br&gt;` and the delimiters are escaped, exactly as the user's
 * existing decks encode them. Schedule comments are stripped, because a
 * review state that only Obsidian understands is noise inside Anki.
 *
 * Pure. Returns the empty header alone for an empty list rather than failing,
 * so exporting a deck that happens to have no cards is not an error.
 */
export function ankiDeck(cards: Card[], deck: AnkiDeck): string {
	const header = [
		'#separator:Tab',
		'#html:true',
		`#deck:${deck.name}`,
		...(deck.tags?.length ? [`#tags:${deck.tags.join(' ')}`] : []),
		''
	];
	const rows = cards.map((card) => `${field(card.question)}\t${field(card.answer)}`);
	return [...header, ...rows, ''].join('\n');
}

/**
 * One side of a card as Anki stores it: HTML-escaped, schedule comments
 * removed, newlines as `&lt;br&gt;` and tabs reduced to spaces so they can
 * never be read as the column separator.
 */
function field(text: string): string {
	return text
		.replace(/\s?<!--SR:.*?-->/g, '')
		.replace(/\t/g, ' ')
		.split('\n')
		.map((line) =>
			line
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.trimEnd()
		)
		.join('&lt;br&gt;')
		.trim();
}

/**
 * The one-time import of the user's Anki decks into the study area.
 *
 * The decks are the `.txt` exports under `Flashcards/`. Each becomes one card
 * file under the study home's own `Flashcards/` folder, at the same path, so
 * `Flashcards/CS/Networking/HTTP.txt` becomes
 * `Study/Flashcards/CS/Networking/HTTP.md`. Turning a deck into that file is
 * `anki-import.ts`'s job; this module decides which files to write and writes
 * them.
 *
 * It only ever creates. A card file that already exists is the author's, and
 * may already carry review history, so it is skipped and reported rather than
 * replaced; running the import again is therefore harmless and only fills in
 * what is missing. The `.txt` decks are read and never written, renamed or
 * deleted: this module holds no call that could.
 */

import { deckNote, parseAnkiDeck } from './anki-import';
import { studyPath } from './topics';
import { hashContent, type Vault } from '../vault/index';
import type { DeckImport } from '$lib/shared/anki-import';

export type { DeckImport };

/** Where the Anki exports live, vault-relative. */
export const ANKI_FOLDER = 'Flashcards';

/**
 * Every deck under `Flashcards/` and what importing it does; with `apply`,
 * the import itself.
 *
 * `home` is the study area's home folder, '' for the vault root. Decks come
 * back in path order, each with its target, card count, first card and any
 * problems reading it.
 *
 * Without `apply`, nothing is written and each deck is `new`, `exists` or
 * `empty`. With it, each `new` deck's file is written and comes back
 * `created`; one that appeared since it was listed comes back `exists`,
 * untouched. Never overwrites a file, never writes to a `.txt`, and never
 * throws for a deck it cannot read: a deck that has vanished reads as empty.
 */
export async function importAnkiDecks(vault: Vault, home: string, opts: { apply?: boolean } = {}): Promise<DeckImport[]> {
	const out: DeckImport[] = [];
	for (const below of await vault.files(ANKI_FOLDER, 'txt', { deep: true })) {
		const source = `${ANKI_FOLDER}/${below}`;
		const target = studyPath(home, `${ANKI_FOLDER}/${below.replace(/\.txt$/, '.md')}`);
		const file = parseAnkiDeck((await vault.read(source)).content, source);
		const base = {
			source,
			target,
			deck: file.deck,
			cards: file.cards.length,
			sample: file.cards[0] ?? null,
			problems: file.problems
		};

		if (!file.cards.length) {
			out.push({ ...base, status: 'empty' });
			continue;
		}
		if ((await vault.read(target)).exists) {
			out.push({ ...base, status: 'exists' });
			continue;
		}
		if (!opts.apply) {
			out.push({ ...base, status: 'new' });
			continue;
		}
		// The hash of an empty file: a write that finds something already there
		// is refused as a conflict, so a file made a moment ago is never lost.
		const written = await vault.write(target, deckNote(file, source), hashContent(''));
		out.push({ ...base, status: written.ok ? 'created' : 'exists' });
	}
	return out;
}

/**
 * The one-time import of the user's Anki decks into the study area.
 *
 * The decks are the `.txt` exports under `Flashcards/`. Each becomes one card
 * file under one subject's own `Flashcards/` folder, at the same path with
 * ` (cards)` added to its name, so `Flashcards/CS/Networking/HTTP.txt`
 * becomes `Study/Computer Science/Flashcards/CS/Networking/HTTP (cards).md`.
 * The decks were exported from notes and carry their names, so without the
 * suffix every card file would share its name with the note it came from,
 * and `[[HTTP]]` in Obsidian could open either. Turning a deck into that file is
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
import { hashContent, type Vault } from '../vault/index';
import type { DeckImport } from '$lib/shared/anki-import';

export type { DeckImport };

/** Where the Anki exports live, vault-relative. */
const ANKI_FOLDER = 'Flashcards';

/** Added to a deck's name for its card file, so it never shares a note's name. */
const CARD_FILE_SUFFIX = ' (cards)';

/**
 * Every deck under `Flashcards/` and what importing it does; with `apply`,
 * the import itself.
 *
 * `home` is the subject's home folder (`studyHome`), vault-relative; '' puts
 * the card files beside the decks. Decks come back in path order, each with
 * its target, card count, first card and any problems reading it.
 *
 * Without `apply`, nothing is written and each deck is `new`, `exists` or
 * `empty`. With it, each `new` deck's file is written and comes back
 * `created`; one that appeared since it was listed comes back `exists`,
 * untouched. `only`, when given, limits the writing to those source paths;
 * any other deck is reported as it would be without `apply`. Never
 * overwrites a file, never writes to a `.txt`, and never throws for a deck it
 * cannot read: a deck that has vanished reads as empty.
 */
export async function importAnkiDecks(
	vault: Vault,
	home: string,
	opts: { apply?: boolean; only?: readonly string[] } = {}
): Promise<DeckImport[]> {
	const chosen = opts.only ? new Set(opts.only) : null;
	const out: DeckImport[] = [];
	for (const below of await vault.files(ANKI_FOLDER, 'txt', { deep: true })) {
		const source = `${ANKI_FOLDER}/${below}`;
		const folder = home.replace(/\/+$/, '');
		const target = `${folder ? `${folder}/` : ''}${ANKI_FOLDER}/${below.replace(/\.txt$/, `${CARD_FILE_SUFFIX}.md`)}`;
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
		if (!opts.apply || (chosen && !chosen.has(source))) {
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

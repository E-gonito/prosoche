/**
 * What the Anki import says about each deck, shared by the server module that
 * plans and writes it (`$server/study/anki-decks`), the route that serialises
 * it and the page that previews it. Data only.
 */

/**
 * What importing a deck does, or did:
 *
 * - `new`: its card file does not exist yet; Import will write it.
 * - `created`: Import wrote it just now.
 * - `exists`: a file is already at the target; it is left alone.
 * - `empty`: the deck has no card worth writing, so no file is made.
 */
export type DeckStatus = 'new' | 'created' | 'exists' | 'empty';

/** One Anki deck file and the markdown card file it becomes. */
export interface DeckImport {
	/** The `.txt`, vault-relative, e.g. `Flashcards/CS/Networking/HTTP.txt`. */
	source: string;
	/** The card file, vault-relative, e.g. `Study/Flashcards/CS/Networking/HTTP.md`. */
	target: string;
	/** Anki's deck name, `::` separated. */
	deck: string;
	/** Cards the file holds, or would hold. */
	cards: number;
	/** The deck's first card, both sides as markdown, or null for an empty deck. */
	sample: { front: string; back: string } | null;
	/** Anything skipped or guessed while reading the deck, each said once. */
	problems: string[];
	status: DeckStatus;
}

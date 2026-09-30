/**
 * Where a subject's own card files live.
 *
 * A subject keeps its cards in its own `Flashcards/` folder, one file per
 * goal, `<home>/Flashcards/<Goal>.md`, or `From notes.md` for cards under no
 * goal, so the Flashcards tab groups them and a note stays the author's
 * prose. The Anki import and the glossary cards both write there.
 */

import type { Subject } from './subjects';

/** The card file for cards under no goal, without `.md`. */
const FROM_NOTES = 'From notes';

/**
 * The card file cards under `goal` go to: `<home>/Flashcards/<goal>.md`, or
 * `<home>/Flashcards/From notes.md` for none. A goal's name is made a file
 * name by turning anything a file name or a wikilink cannot hold into a
 * space. Pure. Always inside the subject's `Flashcards/` folder.
 */
export function cardFilePath(subject: Pick<Subject, 'files'>, goal: string | null): string {
	const name = goal ? goal.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '') : '';
	return `${subject.files.flashcards}/${name || FROM_NOTES}.md`;
}

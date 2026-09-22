/**
 * Collapsing a repeated segment out of a flashcard's context trail.
 *
 * `Card.context` is a note title followed by its heading trail, joined with
 * ` › ` in `$server/study/flashcards`. A note named after its only heading —
 * or a heading repeating its parent's name, which happens whenever a
 * curriculum note nests a single top-level section — reads back as
 * "Scheduling › Scheduling › Algorithms". Nothing downstream should have to
 * know the join character or the note-naming habits that cause the repeat, so
 * the fix lives here once rather than in every place a context is shown.
 */

const SEPARATOR = ' › ';

/** `context`, with consecutive identical segments collapsed to one. */
export function collapseBreadcrumb(context: string): string {
	const segments = context.split(SEPARATOR);
	const out: string[] = [];
	for (const segment of segments) {
		if (out[out.length - 1] !== segment) out.push(segment);
	}
	return out.join(SEPARATOR);
}

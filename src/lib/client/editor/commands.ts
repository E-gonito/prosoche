/**
 * The text transforms behind the editor's selection toolbar.
 *
 * Pure functions over a document and a selection, so the string handling can
 * be tested without an editor. The CodeMirror wrappers in `Editor.svelte` do
 * nothing but apply what these return.
 */

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
	/** Where the selection should sit afterwards. */
	selectFrom: number;
	selectTo: number;
}

/**
 * Wrap or unwrap a selection in a pair of markers.
 *
 * Already wrapped means the markers sit immediately outside the selection, so
 * pressing bold twice returns the text to where it started rather than nesting.
 * With nothing selected, the markers are inserted and the cursor is placed
 * between them, ready to type.
 */
export function wrap(doc: string, from: number, to: number, open: string, close = open): TextEdit {
	const selected = doc.slice(from, to);

	const outerOpen = doc.slice(Math.max(0, from - open.length), from);
	const outerClose = doc.slice(to, to + close.length);
	if (outerOpen === open && outerClose === close) {
		const start = from - open.length;
		return { from: start, to: to + close.length, insert: selected, selectFrom: start, selectTo: start + selected.length };
	}

	if (selected.startsWith(open) && selected.endsWith(close) && selected.length > open.length + close.length) {
		const inner = selected.slice(open.length, selected.length - close.length);
		return { from, to, insert: inner, selectFrom: from, selectTo: from + inner.length };
	}

	const insert = `${open}${selected}${close}`;
	return {
		from,
		to,
		insert,
		selectFrom: from + open.length,
		selectTo: from + open.length + selected.length
	};
}

/**
 * Turn the selection into a spaced-repetition question.
 *
 * The Obsidian Spaced Repetition plugin reads `Question::Answer` on one line,
 * so the selection becomes the question and the cursor lands after the
 * separator for the answer. The note still needs a `#flashcards` tag for the
 * plugin to collect it; that stays an explicit choice rather than something
 * this edit does behind the user's back.
 */
export function asCard(doc: string, from: number, to: number): TextEdit {
	const question = doc.slice(from, to).trim();
	if (!question) {
		return { from, to, insert: '::', selectFrom: from + 2, selectTo: from + 2 };
	}
	const insert = `${question}::`;
	return { from, to, insert, selectFrom: from + insert.length, selectTo: from + insert.length };
}

/** Wrap the selection in `==highlight==`, which the plugin reads as a cloze. */
export function asCloze(doc: string, from: number, to: number): TextEdit {
	return wrap(doc, from, to, '==', '==');
}

/** Wrap the selection as a wikilink, or unwrap one. */
export function asWikilink(doc: string, from: number, to: number): TextEdit {
	return wrap(doc, from, to, '[[', ']]');
}

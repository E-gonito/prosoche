/**
 * Finding words in the text pdf.js lays over a page, so they can be marked.
 *
 * A page's text layer is a list of items (one string each, usually a line or
 * part of one). Quotes and search terms are compared with case, runs of
 * whitespace and soft hyphens ignored, and items read as separated by a
 * space, so a phrase that wraps across two lines still matches. A match is
 * given as positions in the items' own strings, so the caller can build a DOM
 * Range from them. Pure; never throws.
 */

/** A position in the items: item number and character offset within its string. */
export interface TextPos {
	item: number;
	offset: number;
}

/** A run of text: from `start` up to, not including, `end`. */
export interface TextMatch {
	start: TextPos;
	end: TextPos;
}

interface Haystack {
	text: string;
	/** For each character of `text`, where it came from. */
	origin: TextPos[];
}

/** The words of `s` the way matching sees them: lower case, one space between words, none at the ends. */
export function normalizeText(s: string): string {
	return build([s]).text;
}

function build(items: readonly string[]): Haystack {
	let text = '';
	const origin: TextPos[] = [];
	const push = (ch: string, pos: TextPos) => {
		if (/\s/.test(ch)) {
			if (text === '' || text.endsWith(' ')) return;
			ch = ' ';
		}
		for (const c of ch.toLowerCase()) {
			text += c;
			origin.push(pos);
		}
	};
	items.forEach((str, item) => {
		for (let offset = 0; offset < str.length; offset++) {
			if (str[offset] === '­') continue;
			push(str[offset], { item, offset });
		}
		push(' ', { item, offset: str.length });
	});
	if (text.endsWith(' ')) {
		text = text.slice(0, -1);
		origin.pop();
	}
	return { text, origin };
}

function matchAt(h: Haystack, from: number, length: number): TextMatch {
	const last = h.origin[from + length - 1];
	return { start: h.origin[from], end: { item: last.item, offset: last.offset + 1 } };
}

/**
 * Every place `needle` occurs in `items`, in order, without overlap. At most
 * `limit`. Empty for a needle with no words.
 */
export function findAll(items: readonly string[], needle: string, limit = 200): TextMatch[] {
	const want = normalizeText(needle);
	if (!want) return [];
	const h = build(items);
	const found: TextMatch[] = [];
	for (let at = h.text.indexOf(want); at >= 0 && found.length < limit; at = h.text.indexOf(want, at + want.length)) {
		found.push(matchAt(h, at, want.length));
	}
	return found;
}

/** How many words of a long quote's start and end are matched when the whole will not. */
const EDGE_WORDS = 6;

/**
 * Where a highlighted quote is on a page, best effort. The whole quote if it
 * is there; else, for a quote of more than a dozen words (pdf.js may split or
 * reorder items oddly), from where its first words start to where its last
 * words end, or just its first words. Null when nothing is found.
 */
export function findQuote(items: readonly string[], quote: string): TextMatch | null {
	const want = normalizeText(quote);
	if (!want) return null;
	const h = build(items);
	const whole = h.text.indexOf(want);
	if (whole >= 0) return matchAt(h, whole, want.length);
	const words = want.split(' ');
	if (words.length <= EDGE_WORDS * 2) return null;
	const head = words.slice(0, EDGE_WORDS).join(' ');
	const tail = words.slice(-EDGE_WORDS).join(' ');
	const from = h.text.indexOf(head);
	if (from < 0) return null;
	const to = h.text.indexOf(tail, from + head.length);
	return matchAt(h, from, to >= 0 ? to + tail.length - from : head.length);
}

/**
 * The subsequence matcher the command palette ranks with.
 *
 * Pure and deterministic: no state, no locale, no clock. It is in `shared/`
 * because the palette's list is assembled on both sides — the server ranks
 * task lines it already has in memory, the browser ranks the commands that
 * only exist there — and one ranking rule in two places would drift.
 *
 * **Ranking rules**, in the order they matter:
 *
 *  1. Every character of the query must appear in the text in order, ignoring
 *     case. Anything else is not a match at all, not a weak one.
 *  2. A character that starts a word scores most: the first character, one
 *     after a space, `/`, `-`, `_`, `.`, `(`, `#`, or the capital in `noteRow`.
 *     Typing initials therefore finds `Work/Atlas/Notes` with `wan`.
 *  3. A character immediately after the previous match scores next most, so a
 *     contiguous run beats the same characters scattered.
 *  4. Matching the whole text, or its start, adds a bonus on top: an exact
 *     name outranks a longer name that merely contains it.
 *  5. Characters skipped before the first match cost a little, so a hit near
 *     the front wins.
 *  6. Ties go to the shorter text, then the earlier first match, then the
 *     order the caller supplied — `fuzzySort` is stable, so a caller's own
 *     preference survives.
 *
 * The score is the best way of lining the query up against the text, not the
 * first one found. Taking the first would rank `Toggle sidebar` above `Go to
 * Today` for `tod`, because the leading `to` is found before the real word is.
 *
 * An empty query matches everything with score 0 and no highlight, which is
 * what an empty palette box should show.
 */

export interface FuzzyMatch {
	score: number;
	/** Indexes into the original text, ascending, for highlighting. */
	positions: number[];
}

const BOUNDARY = new Set([' ', '\t', '/', '\\', '-', '_', '.', ',', '(', '[', '#', ':', '>']);

const WORD_START = 8;
const CONSECUTIVE = 6;
const BASE = 1;
const EXACT = 100;
const PREFIX = 50;
const LEADING_SKIP = 1;
const MAX_LEADING_PENALTY = 20;

/**
 * Score `text` against `query`, or return null when the query's characters do
 * not appear in the text in order.
 *
 * The score is the best alignment, found by a row-at-a-time scan over the
 * text for each query character: one pass per character, so a palette can
 * rank a few hundred rows on every keystroke. Cost is O(query × text) time
 * and the same in memory, which for note titles and commands is a few
 * thousand numbers.
 *
 * Never mutates either argument and never throws, whatever is in the query.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
	const needle = query.trim().toLowerCase();
	if (!needle) return { score: 0, positions: [] };
	const hay = text.toLowerCase();
	const m = needle.length;
	const n = hay.length;
	if (m > n) return null;

	// `best[i][j]` is the score of the best alignment of the first i+1 query
	// characters in which query[i] lands on text[j]; `from[i][j]` is the column
	// query[i-1] landed on in that alignment, so the positions can be walked
	// back once the winner is known.
	const best: Float64Array[] = [];
	const from: Int32Array[] = [];

	for (let i = 0; i < m; i++) {
		const row = new Float64Array(n).fill(-Infinity);
		const parent = new Int32Array(n).fill(-1);
		const previous = best[i - 1];
		// The best place query[i-1] could have landed strictly before j, and
		// where that was, carried along the sweep instead of searched for.
		let gap = -Infinity;
		let gapAt = -1;

		for (let j = 0; j < n; j++) {
			if (i > 0 && j > 0 && previous[j - 1] > gap) {
				gap = previous[j - 1];
				gapAt = j - 1;
			}
			if (hay[j] !== needle[i]) continue;

			const here = BASE + (isWordStart(text, j) ? WORD_START : 0);
			if (i === 0) {
				row[j] = here - Math.min(j * LEADING_SKIP, MAX_LEADING_PENALTY);
				continue;
			}
			const run = j > 0 && previous[j - 1] > -Infinity ? previous[j - 1] + CONSECUTIVE : -Infinity;
			if (run >= gap && run > -Infinity) {
				row[j] = run + here;
				parent[j] = j - 1;
			} else if (gap > -Infinity) {
				row[j] = gap + here;
				parent[j] = gapAt;
			}
		}
		best.push(row);
		from.push(parent);
	}

	const last = best[m - 1];
	let end = -1;
	for (let j = 0; j < n; j++) if (last[j] > (end === -1 ? -Infinity : last[end])) end = j;
	if (end === -1) return null;

	const positions: number[] = new Array(m);
	for (let i = m - 1, j = end; i >= 0; i--) {
		positions[i] = j;
		j = from[i][j];
	}

	let score = last[end];
	if (hay === needle) score += EXACT;
	else if (hay.startsWith(needle)) score += PREFIX;
	return { score, positions };
}

/**
 * Rank `items` by how well `text(item)` matches the query, best first, keeping
 * only the ones that match. Stable: items the rules cannot separate stay in
 * the order they arrived, so a caller that already sorted by recency keeps it.
 *
 * Pure. `text` is called once per item and must not have side effects.
 */
export function fuzzySort<T>(query: string, items: readonly T[], text: (item: T) => string): Array<{ item: T; match: FuzzyMatch }> {
	const scored: Array<{ item: T; match: FuzzyMatch; length: number }> = [];
	for (const item of items) {
		const value = text(item);
		const match = fuzzyMatch(query, value);
		if (match) scored.push({ item, match, length: value.length });
	}
	scored.sort(
		(a, b) =>
			b.match.score - a.match.score ||
			a.length - b.length ||
			(a.match.positions[0] ?? 0) - (b.match.positions[0] ?? 0)
	);
	return scored.map(({ item, match }) => ({ item, match }));
}

/**
 * Split `text` into runs for rendering, marking the matched characters. Lets a
 * component highlight without building HTML strings, the same way the search
 * page splits the index's «» markers.
 */
export function fuzzyParts(text: string, positions: readonly number[]): Array<{ text: string; hit: boolean }> {
	const marked = new Set(positions);
	const parts: Array<{ text: string; hit: boolean }> = [];
	for (let i = 0; i < text.length; i++) {
		const hit = marked.has(i);
		const last = parts[parts.length - 1];
		if (last && last.hit === hit) last.text += text[i];
		else parts.push({ text: text[i], hit });
	}
	return parts;
}

/** True when the character at `index` begins a word, camelCase included. */
function isWordStart(text: string, index: number): boolean {
	if (index === 0) return true;
	const before = text[index - 1];
	if (BOUNDARY.has(before)) return true;
	const here = text[index];
	return before === before.toLowerCase() && before !== before.toUpperCase() && here === here.toUpperCase() && here !== here.toLowerCase();
}

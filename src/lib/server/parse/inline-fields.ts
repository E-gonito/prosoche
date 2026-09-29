/**
 * Scanning `key:: value` tokens inline in a list line.
 *
 * The Dating module has two line grammars that are otherwise unrelated — the
 * Ledger's `sent:: 12 matches:: 2`, a person's dates log's `rating:: 4 cost::
 * 9` — but both are the same handful of characters: a recognised key word
 * directly followed by `::`, its value running to the next recognised key or
 * the end of the line. One scanner here, so that mechanic is right once
 * rather than twice; each grammar still lives in its own file, because what
 * the keys mean and how a line starts is not shared.
 *
 * `lastKey` stops the scan at the first field with that name, and everything
 * after becomes its value, verbatim. That is what lets a ledger's `notes` or
 * a date's `notes` hold free text containing its own `::` without being
 * split into fields that do not exist.
 */

export interface FieldHit<K extends string> {
	key: K;
	/** Where the key itself starts, so a caller can insert immediately before it. */
	keyStart: number;
	/** Trimmed value span: the digits or words only, never the whitespace around them. */
	valueStart: number;
	valueEnd: number;
}

/**
 * Find every `key::` marker from `keys` in `text`, in order, with the value
 * span each owns. Pure. Never matches a key that is part of a longer word,
 * e.g. `assent::` does not read as `sent::`.
 */
export function scanInlineFields<K extends string>(text: string, keys: readonly K[], lastKey: K): FieldHit<K>[] {
	const marker = new RegExp(`\\b(${keys.join('|')})::`, 'g');
	let hits: Array<{ key: K; keyStart: number; markerEnd: number }> = [];
	for (const m of text.matchAll(marker)) {
		hits.push({ key: m[1] as K, keyStart: m.index, markerEnd: m.index + m[0].length });
	}

	const stopAt = hits.findIndex((h) => h.key === lastKey);
	if (stopAt !== -1) hits = hits.slice(0, stopAt + 1);

	return hits.map((h, i) => {
		const regionEnd = i + 1 < hits.length ? hits[i + 1].keyStart : text.length;
		let valueStart = h.markerEnd;
		let valueEnd = regionEnd;
		while (valueStart < valueEnd && /\s/.test(text[valueStart])) valueStart++;
		while (valueEnd > valueStart && /\s/.test(text[valueEnd - 1])) valueEnd--;
		return { key: h.key, keyStart: h.keyStart, valueStart, valueEnd };
	});
}

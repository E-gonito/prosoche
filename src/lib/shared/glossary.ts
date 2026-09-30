/**
 * What the server and the browser agree on about glossary terms: how two
 * spellings of a term are compared. The page de-duplicates terms the same way
 * the server refuses one the glossary already has.
 */

/** How two spellings of a term are compared: trimmed, spaced once, lower-case. Pure. */
export function normaliseTerm(term: string): string {
	return term.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * What the server and the browser agree on about glossary terms: how two
 * spellings of a term are compared, and what the scan for new terms sends
 * between them.
 *
 * A scan reads the notes under the folders a glossary names in its
 * frontmatter, batch by batch, and Claude drafts candidate entries from
 * them. The candidates come back to the page for a person to tick and edit;
 * only the entries they keep are sent back to be written. The page
 * de-duplicates candidates the same way the server refuses a term the
 * glossary already has, so the comparison lives here.
 */

/** How two spellings of a term are compared: trimmed, spaced once, lower-case. Pure. */
export function normaliseTerm(term: string): string {
	return term.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The longest each field of a new entry may be, in characters. */
export const ENTRY_LIMITS = { term: 120, category: 60, definition: 1500, relevance: 600 } as const;

/** Entries one add may carry. More is a second press. */
export const MAX_NEW_ENTRIES = 300;

/** A term Claude found in a note, grounded in a sentence of it. */
export interface ScanCandidate {
	term: string;
	category: string;
	definition: string;
	/** Why it matters for the glossary: its `→` line. */
	relevance: string;
	/** The note it came from, vault-relative. */
	source: string;
	/** That note's name, for `source:: [[<name>]]`. */
	note: string;
	/** The sentence of the note that names the term, as Claude quoted it. */
	quote: string;
}

/** One batch of a scan, as drafted. Nothing has been written. */
export interface ScanDraft {
	/** Terms the notes support, new to the glossary and to the `found` list sent. */
	candidates: ScanCandidate[];
	/** Terms whose quote is not in their note, or does not name them. */
	leftOut: ScanCandidate[];
	/** The notes actually sent, in order. */
	read: string[];
	/** Why the batch drafted nothing, when that needs saying; null otherwise. */
	problem: string | null;
}

/** The notes one kind of scan would read, split into the batches it reads them in. */
export interface ScanBatches {
	/** Notes with text to read. */
	notes: number;
	/** Vault-relative paths, one list per Claude run, in path order. */
	batches: string[][];
}

/** Where a glossary scans, when it last did, and what a scan would read now. */
export interface ScanPlan {
	/** The folders in the glossary's `sources:`, vault-relative, as written. */
	sources: string[];
	/** The glossary's `scanned:` date, `YYYY-MM-DD`, or null before the first scan. */
	scanned: string | null;
	/** Notes changed on or after `scanned`; every note when there is no `scanned`. */
	changed: ScanBatches;
	/** Every note under the sources. */
	all: ScanBatches;
}

/**
 * An entry a person chose to add, as they left it. With a definition it is
 * written looked up; without one, to look up.
 */
export interface ScannedEntry {
	term: string;
	category: string;
	/** Empty for a term to look up later. */
	definition: string;
	relevance: string;
	/** The note it was drafted from, vault-relative; empty for a term typed in. */
	source: string;
	/** True when the definition is Claude's draft, so `drafted:: Claude` is written with it. */
	drafted: boolean;
}

/**
 * New cards per day: how many cards never reviewed may join a subject's
 * reviews today.
 *
 * A subject lets `newPerDay` unseen cards in a day (20 unless its workspace
 * file says `new_per_day:`), the first ones in a stable order, and the rest
 * wait. `dueCards` does the choosing; this module says how many each
 * subject may still let in today, which needs to know how many it already
 * has. Each first review of a card is counted, per subject and day, in one
 * small file:
 *
 *     _hub/.state/new-cards.json
 *     { "day": "2026-09-29", "introduced": { "cs-study": 7 } }
 *
 * Why a record rather than reading it off the review comments: a first
 * review writes nothing a later one could not. A new card graded Good today
 * reads `!<today + 3>,3,250`, exactly what a card on a one-day interval
 * graded Good today reads; one graded Again reads as due today at interval
 * 0, as any lapse does. The comments cannot say which cards were new this
 * morning, and without that every card graded would let another new one in.
 *
 * The file is transient, like the proposals queue beside it: `_hub/.state/`
 * is never committed, it holds only today, and losing it only lets up to a
 * day's new cards in again. A card first reviewed in Obsidian is not
 * counted here; the plugin keeps its own daily limit.
 */

import { config } from '../config';
import { parseNote } from '../parse/note';
import { inScope } from './scope';
import type { StudyScope } from '$lib/shared/study';
import type { Subject } from './subjects';
import type { Vault } from '../vault/index';

/** Where today's count of first reviews is kept. Never committed. */
export const NEW_CARDS_PATH = `${config.hubFolder}/.state/new-cards.json`;

/** How many unseen cards one part of the vault may still let in today. */
export interface NewCardQuota {
	scope: StudyScope;
	allowance: number;
}

/**
 * Each subject's scope and how many new cards it may still let in on
 * `day`: its `newPerDay` less the first reviews counted for it that day,
 * never below 0. In the order given. Reads one file; never writes.
 */
export async function newCardQuotas(vault: Vault, subjects: Subject[], day: string): Promise<NewCardQuota[]> {
	const counts = await introduced(vault, day);
	return subjects.map((s) => ({ scope: s.scope, allowance: Math.max(0, s.newPerDay - (counts[s.slug] ?? 0)) }));
}

/**
 * Count one card's first review on `day` against every subject whose scope
 * holds its note (`path`, whose text `content` gives its tags). A card in no
 * subject counts for none.
 *
 * Writes `NEW_CARDS_PATH`, dropping any other day's counts; a clash with
 * another review's write is retried. Never throws: a count that cannot be
 * written is lost, which lets one more card in today.
 */
export async function recordIntroduced(vault: Vault, subjects: Subject[], path: string, content: string, day: string): Promise<void> {
	const tags = parseNote(content, path).tags;
	const slugs = subjects.filter((s) => inScope(path, tags, s.scope)).map((s) => s.slug);
	if (!slugs.length) return;
	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			const note = await vault.read(NEW_CARDS_PATH);
			const counts = readCounts(note.content, day);
			for (const slug of slugs) counts[slug] = (counts[slug] ?? 0) + 1;
			const text = `${JSON.stringify({ day, introduced: counts }, null, '\t')}\n`;
			if ((await vault.write(NEW_CARDS_PATH, text, note.hash)).ok) return;
		}
	} catch (e) {
		console.warn('[study] could not count a new card', e);
	}
}

/** The first reviews counted on `day`, by subject slug; none for another day. */
async function introduced(vault: Vault, day: string): Promise<Record<string, number>> {
	return readCounts((await vault.read(NEW_CARDS_PATH)).content, day);
}

/** The counts in the file's text for `day`; anything unreadable, or another day's, is none. */
function readCounts(text: string, day: string): Record<string, number> {
	try {
		const parsed = JSON.parse(text) as { day?: unknown; introduced?: unknown };
		if (parsed?.day !== day || typeof parsed.introduced !== 'object' || parsed.introduced === null) return {};
		const out: Record<string, number> = {};
		for (const [slug, n] of Object.entries(parsed.introduced)) if (Number.isInteger(n) && (n as number) > 0) out[slug] = n as number;
		return out;
	} catch {
		return {};
	}
}

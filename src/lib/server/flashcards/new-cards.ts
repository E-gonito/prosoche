/**
 * New cards per day: how many cards never reviewed may join the reviews
 * today, and which ones.
 *
 * Cards are let in by pool: a scope (a folder or one card file) whose new
 * cards are counted together, which is a glossary's deck or, under a focus,
 * one category (see `decks.ts`). The pools may share one number a day
 * between them, and each may have a limit of its own.
 * `releaseNew` does the choosing, a card at a time to whichever pool has
 * begun the fewest today, for `dueCards`, so turning another glossary's
 * cards on changes the mix rather than the total. This module also says how
 * many each pool has already begun, which needs a record.
 *
 * A review left overdue holds back one of the day's new cards, so a day
 * missed makes the next day lighter in new cards rather than heavier in
 * everything: the reviews already owed come first, and each one caught up
 * lets a held card back in the same day. Unseen cards never pile up, since a
 * day's allowance that goes unused is not carried over.
 *
 * Each first review
 * of a card is counted, per card file and day, in one small file:
 *
 *     _hub/.state/new-cards.json
 *     { "day": "2026-09-30", "introduced": { "Flashcards/Computer Science/Cloud (cards).md": 5 } }
 *
 * Counting per file rather than per pool lets the pools change mid-day (a
 * focus is set) without losing what was begun: a pool has begun the sum
 * over the files in its scope, and the day's total is the sum over all.
 *
 * Why a record rather than reading it off the review comments: a card's
 * comment says when it was last answered, not when it was first, and a
 * legacy `<!--SR:…-->` comment says neither. The comments cannot say which
 * cards were new this morning, and without that every card graded would let
 * another new one in.
 *
 * The file is transient, like the proposals queue beside it: `_hub/.state/`
 * is never committed, it holds only today, and losing it only lets up to a
 * day's new cards in again.
 */

import { config } from '../config';
import type { Card } from '$lib/shared/flashcards';
import type { Vault } from '../vault/index';

/** Where today's count of first reviews is kept. Never committed. */
export const NEW_CARDS_PATH = `${config.hubFolder}/.state/new-cards.json`;

/** A scope whose new cards are counted together. */
export interface NewCardPool {
	/** A vault-relative folder or one card file, per `inScope`; the pools' scopes never overlap. */
	scope: string;
	/** The most new cards it lets in a day on its own; null for no limit of its own. */
	perDay: number | null;
}

/** What `releaseNew` needs to choose today's new cards. */
export interface NewCardPlan {
	/** How many more unseen cards may join today across every pool; Infinity for no shared limit. */
	left: number;
	/** Every pool, in the order ties go in. */
	pools: Array<{
		scope: string;
		/** Cards it has had a first review of today. */
		begun: number;
		/** How many more its own limit lets in; null when it has none. */
		room: number | null;
	}>;
}

/**
 * Today's plan for new cards over `pools`: each pool's first reviews counted
 * on `day` and what its own limit leaves, never below 0; and, when `shared`
 * is a number, that many a day less every first review today, whether or
 * not a pool holds it now. Reads one file; never writes.
 */
export async function newCardPlan(vault: Vault, pools: NewCardPool[], day: string, shared: number | null = null): Promise<NewCardPlan> {
	const counts = await introduced(vault, day);
	const files = Object.entries(counts);
	const total = files.reduce((sum, [, n]) => sum + n, 0);
	return {
		left: shared === null ? Infinity : Math.max(0, shared - total),
		pools: pools.map((p) => {
			const begun = files.reduce((sum, [path, n]) => sum + (inScope(path, p.scope) ? n : 0), 0);
			return { scope: p.scope, begun, room: p.perDay === null ? null : Math.max(0, p.perDay - begun) };
		})
	};
}

/**
 * The unseen cards that join today's reviews under `plan`, and how many more
 * would have joined but for `overdue`. Pure.
 *
 * `unseen` is every card never reviewed that might, in the queue's stable
 * order. Cards are let in one at a time, each to the pool that has begun the
 * fewest today, counting those let in here (the earlier pool on a tie),
 * which takes its next card in that order. That goes
 * on until `plan.left` are in or no pool has a card to give: one with none
 * left, or at its own limit, drops out and the rest share what it would
 * have had. So the choice is stable through the day: a deck that did its
 * five this morning gets none of the ten still to come.
 *
 * `overdue` is how many reviewed cards were due before today. Each holds
 * back the last card that would have been let in, down to none; those are
 * counted as `held`. Because the order is fixed, a held card is the same
 * card that joins once a review is caught up.
 *
 * A card in no pool's scope never joins.
 */
export function releaseNew(plan: NewCardPlan, unseen: Card[], overdue = 0): { cards: Set<Card>; held: number } {
	const order: Card[] = [];
	const turns = plan.pools.map((p) => ({
		begun: p.begun,
		room: p.room ?? Infinity,
		queue: unseen.filter((c) => inScope(c.path, p.scope)),
		next: 0
	}));
	for (let left = plan.left; left > 0; left--) {
		let turn: (typeof turns)[number] | null = null;
		for (const t of turns) if (t.room > 0 && t.next < t.queue.length && (!turn || t.begun < turn.begun)) turn = t;
		if (!turn) break;
		order.push(turn.queue[turn.next++]);
		turn.begun++;
		turn.room--;
	}
	const held = Math.min(Math.max(0, overdue), order.length);
	return { cards: new Set(order.slice(0, order.length - held)), held };
}

/**
 * Whether `path` is `scope` itself or inside it as a folder, both
 * vault-relative. The one place that says what a pool's scope holds. Pure.
 */
export function inScope(path: string, scope: string): boolean {
	return path === scope || path.startsWith(`${scope.replace(/\/$/, '')}/`);
}

/**
 * Count one card's first review on `day` against its note, `path`.
 *
 * Writes `NEW_CARDS_PATH`, dropping any other day's counts; a clash with
 * another review's write is retried. Never throws: a count that cannot be
 * written is lost, which lets one more card in today.
 */
export async function recordIntroduced(vault: Vault, path: string, day: string): Promise<void> {
	try {
		for (let attempt = 0; attempt < 3; attempt++) {
			const note = await vault.read(NEW_CARDS_PATH);
			const counts = readCounts(note.content, day);
			counts[path] = (counts[path] ?? 0) + 1;
			const text = `${JSON.stringify({ day, introduced: counts }, null, '\t')}\n`;
			if ((await vault.write(NEW_CARDS_PATH, text, note.hash)).ok) return;
		}
	} catch (e) {
		console.warn('[flashcards] could not count a new card', e);
	}
}

/** The first reviews counted on `day`, by card file (an older file's keys are decks, which still count in the day's total); none for another day. */
async function introduced(vault: Vault, day: string): Promise<Record<string, number>> {
	return readCounts((await vault.read(NEW_CARDS_PATH)).content, day);
}

/** The counts in the file's text for `day`; anything unreadable, or another day's, is none. */
function readCounts(text: string, day: string): Record<string, number> {
	try {
		const parsed = JSON.parse(text) as { day?: unknown; introduced?: unknown };
		if (parsed?.day !== day || typeof parsed.introduced !== 'object' || parsed.introduced === null) return {};
		const out: Record<string, number> = {};
		for (const [key, n] of Object.entries(parsed.introduced)) if (Number.isInteger(n) && (n as number) > 0) out[key] = n as number;
		return out;
	} catch {
		return {};
	}
}

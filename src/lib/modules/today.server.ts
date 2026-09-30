/**
 * A module's contribution to the Today dashboard.
 *
 * `docs/plan-rebuild.md` gives Today its own list of what to show; everything
 * else a module wants on that dashboard is a card, offered here rather than
 * Today reaching into another module's tables. `.server.ts` because every
 * contributor reads the vault and the index — this file, and everything it
 * imports, never reaches the browser.
 *
 * A private module (only Date, today) must never contribute: nothing of
 * its should appear anywhere but its own screen. `today.server.test.ts`
 * checks that by construction, against `MODULES`, so a future contributor
 * cannot reintroduce the leak by mistake.
 */

import type { Hub } from '$server/hub';
import { flashcardsOverview } from '$server/flashcards/decks';

export interface TodayCard {
	/** The module this card speaks for, e.g. `flashcards`. Must not be private. */
	module: string;
	title: string;
	href: string;
	items: Array<{ text: string; meta?: string; href?: string }>;
}

interface TodayCardContext {
	/** The day being viewed, `YYYY-MM-DD`. */
	day: string;
	hub: Hub;
}

/**
 * Flashcards due for review today, as one line leading to one review of
 * every glossary's deck, the decks taking turns: the cards reviewed before
 * that are due, and the new ones the day shares out between the decks (see
 * `flashcards/decks.ts`). One line rather than one a deck, so turning
 * another glossary's cards on adds to the mix, not to the list.
 *
 * Inputs: the viewed day and the hub. Output: the card, or null when nothing
 * is ready — a permanent "0 due" card would be noise on every day but the
 * ones it matters. Side effects: reads the vault.
 */
async function flashcardsDue({ day, hub: h }: TodayCardContext): Promise<TodayCard | null> {
	const { due, fresh } = await flashcardsOverview(h.vault, await h.workspaces(), day);
	const ready = due + fresh;
	if (ready === 0) return null;
	return {
		module: 'flashcards',
		title: 'Flashcards due',
		href: '/flashcards',
		items: [{ text: `${ready} card${ready === 1 ? '' : 's'} to review`, meta: fresh ? `${fresh} new today` : undefined, href: '/flashcards/review' }]
	};
}

/**
 * Every module's contributor, in the order their cards should appear.
 *
 * Adding a card is adding a function here, not changing Today's route: the
 * dashboard asks each of these and drops whatever comes back null, so a
 * module with nothing to say today is simply absent rather than an empty box.
 */
export const TODAY_CARDS: Array<(ctx: TodayCardContext) => Promise<TodayCard | null>> = [flashcardsDue];

/** Every card Today has to show, run in parallel and with the nulls dropped. */
export async function todayCards(ctx: TodayCardContext): Promise<TodayCard[]> {
	const cards = await Promise.all(TODAY_CARDS.map((contribute) => contribute(ctx)));
	return cards.filter((c): c is TodayCard => c !== null);
}

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
import { subjectsOf } from '$server/study/subjects';
import { dueEverywhere } from '$server/study/summary';

export interface TodayCard {
	/** The module this card speaks for, e.g. `study`. Must not be private. */
	module: string;
	title: string;
	href: string;
	items: Array<{ text: string; meta?: string; href?: string }>;
}

export interface TodayCardContext {
	/** The day being viewed, `YYYY-MM-DD`. */
	day: string;
	hub: Hub;
}

/**
 * Flashcards due for review today, one line per study subject: each
 * subject's cards due and its own new cards for today, by the same rule as
 * that subject's review, which the line links to. Split so a day can take
 * one subject's twenty rather than every subject's at once.
 *
 * Inputs: the viewed day and the hub. Output: a card with a line for each
 * subject with something ready, in workspace order, or null once no subject
 * has anything — a permanent "0 due" card would be noise on every day but
 * the ones it matters. Side effects: reads the vault and the index.
 */
async function flashcardsDue({ day, hub: h }: TodayCardContext): Promise<TodayCard | null> {
	const subjects = subjectsOf(await h.workspaces());
	const queues = await Promise.all(subjects.map((s) => dueEverywhere(h.vault, h.index, [s], day, 0)));
	const items = subjects.flatMap((subject, i) => {
		const { due, fresh } = queues[i];
		const ready = due + fresh;
		if (ready === 0) return [];
		return [
			{
				text: `${subject.name}: ${ready} card${ready === 1 ? '' : 's'}`,
				meta: fresh ? `${fresh} new today` : undefined,
				href: `/study/${subject.slug}/review`
			}
		];
	});
	if (!items.length) return null;

	return { module: 'study', title: 'Flashcards due', href: '/study', items };
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

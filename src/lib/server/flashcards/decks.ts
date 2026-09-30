/**
 * Decks: each glossary's flashcards, reviewed on the Flashcards page rather
 * than in Study.
 *
 * A glossary whose frontmatter turns its cards on (`cardSettings`) is a
 * deck. `glossary-cards.ts` keeps its cards in step with the terms, one file
 * per category under `Flashcards/<Glossary>/`; this module says what is due
 * in each deck and category, and which cards a review holds.
 *
 * The decks share one number of new cards a day, 15 unless
 * `_hub/flashcards.md` says otherwise:
 *
 *     ---
 *     new_per_day: 15
 *     ---
 *
 * dealt out a card at a time to whichever deck has begun the fewest today
 * (see `new-cards.ts`), so fifteen over three decks is five each, a deck
 * with nothing left to learn gives its share to the others, and turning
 * another glossary's cards on changes the mix rather than the total. A
 * glossary's own `new_per_day:` caps its share. A review of every deck takes
 * the decks in turn, a card from each; a review of one deck, or of one
 * category in it, offers exactly that deck's or that category's part of the
 * same cards.
 *
 * Nothing else in the vault is reviewed: a card is always a glossary's.
 */

import { config } from '../config';
import { parseNote } from '../parse/note';
import { setFrontmatterField } from '../parse/frontmatter';
import { cardSettings, glossaries } from '../glossary';
import { deckFolder } from './glossary-cards';
import { dueCards, inFolder, type CardQueue } from './cards';
import { newCardPlan, type NewCardPool } from './new-cards';
import type { Card } from '$lib/shared/flashcards';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';

/** The flashcard settings, of which the new cards a day is the one so far. */
export const FLASHCARD_SETTINGS_PATH = `${config.hubFolder}/flashcards.md`;

/** New cards a day across every deck when `_hub/flashcards.md` does not say. */
const NEW_PER_DAY = 15;

/** The most `setNewCardsPerDay` stores: past this a typo, not a plan. */
const MOST_PER_DAY = 500;

/** The most cards one review session holds. */
const SESSION = 200;

/** A glossary whose terms are flashcards. */
interface Deck {
	name: string;
	/** The glossary's slug, which is the deck's. */
	slug: string;
	color: string;
	/** Where its card files are, vault-relative. */
	folder: string;
	/** Its glossary's `new_per_day:`, capping its share; null for none. */
	perDay: number | null;
}

/** One category of a deck: one card file. */
interface CategoryView {
	/** The file name without `.md`: the glossary's category, or `Uncategorised`. */
	name: string;
	cards: number;
	/** Cards ready to review today, new ones included. */
	ready: number;
}

/** A deck as the Flashcards page shows it. */
interface DeckView {
	name: string;
	slug: string;
	color: string;
	/** Cards reviewed before and due today. */
	due: number;
	/** New cards joining today. */
	fresh: number;
	total: number;
	categories: CategoryView[];
}

/**
 * Every deck: each glossary whose cards are on, in glossary order. Reads
 * each glossary. Never writes.
 */
export async function decks(vault: Vault, workspaces: Workspace[]): Promise<Deck[]> {
	const out: Deck[] = [];
	for (const g of await glossaries(vault, workspaces)) {
		const { on, perDay } = cardSettings((await vault.read(g.path)).content);
		if (on) out.push({ name: g.name, slug: g.slug, color: g.color, folder: deckFolder(g.name), perDay });
	}
	return out;
}

/**
 * Every deck as a pool of new cards (see `new-cards.ts`), for grading a
 * card: the pools say which folders may be written and which count a first
 * review. Reads each glossary. Never writes.
 */
export async function cardPools(vault: Vault, workspaces: Workspace[]): Promise<NewCardPool[]> {
	return (await decks(vault, workspaces)).map(poolOf);
}

/**
 * The new cards a day across every deck, from `_hub/flashcards.md`'s
 * `new_per_day:`: a whole number, 0 for none. 15 when the file, the key or a
 * readable value is missing. Reads one file; never writes.
 */
export async function newCardsPerDay(vault: Vault): Promise<number> {
	const note = await vault.read(FLASHCARD_SETTINGS_PATH);
	return count(parseNote(note.content, FLASHCARD_SETTINGS_PATH).frontmatter.new_per_day) ?? NEW_PER_DAY;
}

type PerDaySet = { ok: true; perDay: number } | { ok: false; reason: 'invalid' | 'conflict' };

/**
 * Set the new cards a day across every deck to `value`, a whole number from
 * 0 to 500 given as a number or digits.
 *
 * Rewrites the one `new_per_day:` line of `_hub/flashcards.md`, every other
 * byte kept, or creates the file when there is none. Refuses anything else
 * as `invalid`, and a clash with another write as `conflict`; never throws.
 */
export async function setNewCardsPerDay(vault: Vault, value: unknown): Promise<PerDaySet> {
	const perDay = count(value);
	if (perDay === null || perDay > MOST_PER_DAY) return { ok: false, reason: 'invalid' };
	const note = await vault.read(FLASHCARD_SETTINGS_PATH);
	const text = note.exists
		? setFrontmatterField(note.content, 'new_per_day', perDay)
		: `---\nnew_per_day: ${perDay}\n---\n\nFlashcard settings. \`new_per_day\` is how many cards never reviewed join the\nreviews each day, shared out between every glossary's deck. A glossary may\nsay \`new_per_day:\` too, which caps its share.\n`;
	const written = await vault.write(FLASHCARD_SETTINGS_PATH, text, note.hash);
	return written.ok ? { ok: true, perDay } : { ok: false, reason: 'conflict' };
}

/**
 * What the Flashcards page shows: every deck with its cards due, new today
 * and in all, and each of its categories with its cards and those ready;
 * the totals across decks; and the new cards a day. Never writes.
 */
export async function flashcardsOverview(
	vault: Vault,
	workspaces: Workspace[],
	day: string
): Promise<{ decks: DeckView[]; due: number; fresh: number; perDay: number }> {
	const [all, perDay] = await Promise.all([decks(vault, workspaces), newCardsPerDay(vault)]);
	const queue = await deckQueue(vault, all, day, perDay);
	const views = all.map((deck): DeckView => {
		const ready = queue.cards.filter((c) => inDeck(deck, c.path));
		const files = queue.files.filter((f) => inDeck(deck, f.path));
		return {
			name: deck.name,
			slug: deck.slug,
			color: deck.color,
			due: ready.filter((c) => c.schedule !== null).length,
			fresh: ready.filter((c) => c.schedule === null).length,
			total: files.reduce((sum, f) => sum + f.cards, 0),
			categories: files.map((f) => ({ name: categoryOf(f.path), cards: f.cards, ready: f.due }))
		};
	});
	return { decks: views, due: queue.due, fresh: queue.fresh, perDay };
}

/**
 * The cards for one review session, fixed at the start: every deck's, the
 * decks taking turns; or, with `filter.deck` (a slug), that deck's; and with
 * `filter.category` too, that category's, matched ignoring case. At most 200
 * cards; `total` is every card in what was asked for. Null for a deck or a
 * category there is not. Never writes.
 */
export async function deckReview(
	vault: Vault,
	workspaces: Workspace[],
	day: string,
	filter: { deck?: string; category?: string } = {}
): Promise<{ cards: Card[]; total: number; deck: { name: string; slug: string } | null; category: string | null } | null> {
	const [all, perDay] = await Promise.all([decks(vault, workspaces), newCardsPerDay(vault)]);
	const queue = await deckQueue(vault, all, day, perDay);
	if (!filter.deck) return { cards: queue.cards.slice(0, SESSION), total: queue.total, deck: null, category: null };

	const deck = all.find((d) => d.slug === filter.deck);
	if (!deck) return null;
	const files = queue.files.filter((f) => inDeck(deck, f.path));
	const wanted = filter.category?.trim().toLowerCase();
	const file = wanted ? files.find((f) => categoryOf(f.path).toLowerCase() === wanted) : null;
	if (wanted && !file) return null;

	const cards = queue.cards.filter((c) => (file ? c.path === file.path : inDeck(deck, c.path)));
	const total = file ? file.cards : files.reduce((sum, f) => sum + f.cards, 0);
	return { cards: cards.slice(0, SESSION), total, deck: { name: deck.name, slug: deck.slug }, category: file ? categoryOf(file.path) : null };
}

/**
 * Everything ready in `all` the decks today, in review order, with every
 * card file: one sweep of their folders, the new cards shared out between
 * them. No decks means no cards.
 */
async function deckQueue(vault: Vault, all: Deck[], day: string, perDay: number): Promise<CardQueue> {
	const plan = await newCardPlan(vault, all.map(poolOf), day, perDay);
	return dueCards(vault, { on: day, folders: all.map((d) => d.folder), newCards: plan, limit: Infinity });
}

/** A deck as a pool of new cards: counted under `deck/<slug>`. Pure. */
function poolOf(deck: Deck): NewCardPool {
	return { key: `deck/${deck.slug}`, folder: deck.folder, perDay: deck.perDay };
}

function inDeck(deck: Deck, path: string): boolean {
	return inFolder(path, deck.folder);
}

/** `Flashcards/CS/Cloud.md` → `Cloud`. */
function categoryOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
}

/** A whole number of zero or more, written as a number or a string of digits; otherwise null. */
function count(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
	return Number.isInteger(n) && n >= 0 ? n : null;
}

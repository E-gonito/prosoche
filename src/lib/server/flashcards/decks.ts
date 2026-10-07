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
 *     focus:
 *       - Computer Science/Networking
 *     ---
 *
 * dealt out a card at a time to whichever deck has begun the fewest today
 * (see `new-cards.ts`), so fifteen over three decks is five each, a deck
 * with nothing left to learn gives its share to the others, and turning
 * another glossary's cards on changes the mix rather than the total. A
 * glossary's own `new_per_day:` caps its share.
 *
 * `focus:` is a list of categories, each `<Glossary>/<Category>`, kept
 * until changed. With one, new cards come only from those categories,
 * evenly between them whichever glossary each is in, and a glossary's cap
 * does not apply; when they run out the day has fewer new cards, the other
 * decks do not fill in. Reviews already due keep coming from every
 * category. An item that matches no category of a deck whose cards are on
 * is ignored, and if none match there is no focus. A review of every deck takes
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
import { categoryOfFile, deckFolder } from './glossary-cards';
import { dueCards, type CardQueue } from './cards';
import { inScope, newCardPlan, type NewCardPool } from './new-cards';
import type { Card } from '$lib/shared/flashcards';
import type { Vault } from '../vault/index';
import type { Workspace } from '../workspaces';

/** The flashcard settings: the new cards a day and the focus. */
export const FLASHCARD_SETTINGS_PATH = `${config.hubFolder}/flashcards.md`;

/** New cards a day across every deck when `_hub/flashcards.md` does not say. */
const NEW_PER_DAY = 15;

/** The most `setFlashcardSettings` stores a day: past this a typo, not a plan. */
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
	/** The glossary's category, or `Uncategorised`, as its file names it. */
	name: string;
	/** `<Glossary>/<Category>`, how `focus:` names it. */
	key: string;
	cards: number;
	/** Cards ready to review today, new ones included. */
	ready: number;
	/** Whether the focus draws today's new cards from it. */
	focused: boolean;
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

/** What `_hub/flashcards.md` says. */
export interface FlashcardSettings {
	/** New cards a day across every deck. */
	perDay: number;
	/** The focus as written, `<Glossary>/<Category>` items, stale ones included; empty for none. */
	focus: string[];
}

/**
 * The settings in `_hub/flashcards.md`: `new_per_day:` a whole number, 0 for
 * none, 15 when the file, the key or a readable value is missing; and the
 * `focus:` list, empty when missing or unreadable. Reads one file; never
 * writes.
 */
export async function flashcardSettings(vault: Vault): Promise<FlashcardSettings> {
	return readSettings((await vault.read(FLASHCARD_SETTINGS_PATH)).content);
}

function readSettings(content: string): FlashcardSettings {
	const { new_per_day, focus } = parseNote(content, FLASHCARD_SETTINGS_PATH).frontmatter;
	const items = Array.isArray(focus) ? focus : typeof focus === 'string' ? [focus] : [];
	return { perDay: count(new_per_day) ?? NEW_PER_DAY, focus: items.filter((i): i is string => typeof i === 'string' && i.trim() !== '').map((i) => i.trim()) };
}

type SettingsSet = ({ ok: true } & FlashcardSettings) | { ok: false; reason: 'invalid' | 'conflict' };

/**
 * Change the settings: `perDay`, a whole number from 0 to 500 given as a
 * number or digits, and/or `focus`, a list of `<Glossary>/<Category>` items
 * (an empty list clears it). A field left out stays as it is.
 *
 * Rewrites only the keys given in `_hub/flashcards.md`, every other byte
 * kept, or creates the file when there is none. Refuses as `invalid` a
 * number out of range, no field at all, or a focus item that is not a
 * category of a deck whose cards are on; a clash with another write is
 * `conflict`. Never throws. Answers the settings as now written.
 */
export async function setFlashcardSettings(vault: Vault, workspaces: Workspace[], patch: { perDay?: unknown; focus?: unknown }): Promise<SettingsSet> {
	if (patch.perDay === undefined && patch.focus === undefined) return { ok: false, reason: 'invalid' };
	const note = await vault.read(FLASHCARD_SETTINGS_PATH);
	let text = note.exists ? note.content : NEW_FILE;
	if (patch.perDay !== undefined) {
		const perDay = count(patch.perDay);
		if (perDay === null || perDay > MOST_PER_DAY) return { ok: false, reason: 'invalid' };
		text = setFrontmatterField(text, 'new_per_day', perDay);
	}
	if (patch.focus !== undefined) {
		const known = await categoryFiles(vault, await decks(vault, workspaces));
		if (!Array.isArray(patch.focus) || !patch.focus.every((item) => typeof item === 'string' && known.has(item))) return { ok: false, reason: 'invalid' };
		text = setFrontmatterField(text, 'focus', [...new Set<string>(patch.focus)]);
	}
	const written = await vault.write(FLASHCARD_SETTINGS_PATH, text, note.hash);
	return written.ok ? { ok: true, ...readSettings(text) } : { ok: false, reason: 'conflict' };
}

/** A new settings file: no key yet, and a line saying what it is for. */
const NEW_FILE = `---\n---\n\nFlashcard settings. \`new_per_day\` is how many cards never reviewed join the\nreviews each day, shared out between every glossary's deck. A glossary may\nsay \`new_per_day:\` too, which caps its share. \`focus\` lists categories,\n\`<Glossary>/<Category>\`, to take the new cards from.\n`;

/**
 * Every category of `all` the decks that has a card file, by the name
 * `focus:` gives it, `<Glossary>/<Category>`, to its file's path. Reads each
 * deck's folder listing. Never writes.
 */
async function categoryFiles(vault: Vault, all: Deck[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	for (const deck of all) {
		for (const name of await vault.files(deck.folder, 'md')) {
			const path = `${deck.folder}/${name}`;
			out.set(`${deck.name}/${categoryOfFile(path)}`, path);
		}
	}
	return out;
}

/**
 * What the Flashcards page shows: every deck with its cards due, new today
 * and in all, and each of its categories with its cards and those ready;
 * the totals across decks, with the new cards held back while reviews are
 * overdue; the new cards a day; and the focus in force, as the
 * `<Glossary>/<Category>` items that matched. Never writes.
 */
export async function flashcardsOverview(
	vault: Vault,
	workspaces: Workspace[],
	day: string
): Promise<{ decks: DeckView[]; due: number; fresh: number; held: number; perDay: number; focus: string[] }> {
	const all = await decks(vault, workspaces);
	const settings = await flashcardSettings(vault);
	const queue = await deckQueue(vault, all, day, settings);
	const focused = new Set(queue.focus);
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
			categories: files.map((f) => {
				const name = categoryOfFile(f.path);
				const key = `${deck.name}/${name}`;
				return { name, key, cards: f.cards, ready: f.due, focused: focused.has(key) };
			})
		};
	});
	return { decks: views, due: queue.due, fresh: queue.fresh, held: queue.held, perDay: settings.perDay, focus: queue.focus };
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
	const all = await decks(vault, workspaces);
	const queue = await deckQueue(vault, all, day, await flashcardSettings(vault));
	if (!filter.deck) return { cards: queue.cards.slice(0, SESSION), total: queue.total, deck: null, category: null };

	const deck = all.find((d) => d.slug === filter.deck);
	if (!deck) return null;
	const files = queue.files.filter((f) => inDeck(deck, f.path));
	const wanted = filter.category?.trim().toLowerCase();
	const file = wanted ? files.find((f) => categoryOfFile(f.path).toLowerCase() === wanted) : null;
	if (wanted && !file) return null;

	const cards = queue.cards.filter((c) => (file ? c.path === file.path : inDeck(deck, c.path)));
	const total = file ? file.cards : files.reduce((sum, f) => sum + f.cards, 0);
	return { cards: cards.slice(0, SESSION), total, deck: { name: deck.name, slug: deck.slug }, category: file ? categoryOfFile(file.path) : null };
}

/**
 * Everything ready in `all` the decks today, in review order, with every
 * card file: one sweep of their folders. The new cards are shared out
 * between the decks, or between the focused categories when `settings` has
 * a focus that matches any; `focus` is the items that matched. Reviews take
 * the decks in turn either way. No decks means no cards.
 */
async function deckQueue(vault: Vault, all: Deck[], day: string, settings: FlashcardSettings): Promise<CardQueue & { focus: string[] }> {
	const files = await categoryFiles(vault, all);
	const focus = [...new Set(settings.focus)].filter((item) => files.has(item));
	const pools = focus.length ? focus.map((item): NewCardPool => ({ scope: files.get(item)!, perDay: null })) : all.map(poolOf);
	const plan = await newCardPlan(vault, pools, day, settings.perDay);
	const queue = await dueCards(vault, { on: day, folders: all.map((d) => d.folder), newCards: plan, dealBy: all.map((d) => d.folder), limit: Infinity });
	return { ...queue, focus };
}

/** A deck as a pool of new cards. Pure. */
function poolOf(deck: Deck): NewCardPool {
	return { scope: deck.folder, perDay: deck.perDay };
}

function inDeck(deck: Deck, path: string): boolean {
	return inScope(path, deck.folder);
}

/** A whole number of zero or more, written as a number or a string of digits; otherwise null. */
function count(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
	return Number.isInteger(n) && n >= 0 ? n : null;
}

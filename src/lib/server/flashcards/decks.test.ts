import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { cardPools, deckReview, decks, FLASHCARD_SETTINGS_PATH, flashcardsOverview, newCardsPerDay, setNewCardsPerDay } from './decks';
import { recordIntroduced } from './new-cards';

const TODAY = '2026-09-30';

/** A card file of `n` new cards, `<prefix>1` to `<prefix>n`. */
const cards = (prefix: string, n: number) => `#flashcards\n\n${Array.from({ length: n }, (_, i) => `${prefix}${i + 1}::x`).join('\n\n')}\n`;

describe('decks', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-decks-'));
		vault = new Vault(root);
		await vault.write('Glossaries/Computer Science.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Glossaries/Filipino.md', '---\nflashcards: true\nnew_per_day: 2\n---\n# Glossary\n');
		await vault.write('Glossaries/Wisdom.md', '---\nstudy: wisdom\n---\n# Glossary\n');
		await vault.write('Glossaries/Off.md', '# Glossary\n');
		await vault.write('Flashcards/Computer Science/Cloud (cards).md', cards('cloud', 8));
		await vault.write('Flashcards/Computer Science/Web (cards).md', `#flashcards\n\nOld::due\n<!--SR:!2026-09-01,4,250-->\n\n${cards('web', 2).slice('#flashcards\n\n'.length)}`);
		await vault.write('Flashcards/Filipino/Tagalog (cards).md', cards('tl', 10));
		await vault.write('Flashcards/Wisdom/Stoicism (cards).md', cards('st', 10));
		await vault.write('Flashcards/Off/Nope (cards).md', cards('off', 3));
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('is every glossary whose cards are on, an old study link counting as on', async () => {
		expect((await decks(vault, [])).map((d) => [d.name, d.folder, d.perDay])).toEqual([
			['Computer Science', 'Flashcards/Computer Science', null],
			['Filipino', 'Flashcards/Filipino', 2],
			['Wisdom', 'Flashcards/Wisdom', null]
		]);
		expect((await cardPools(vault, [])).map((p) => p.key)).toEqual(['deck/computer-science', 'deck/filipino', 'deck/wisdom']);
	});

	it('shares fifteen new cards a day between the decks, a deck’s own cap giving the rest its share', async () => {
		const overview = await flashcardsOverview(vault, [], TODAY);
		expect(overview).toMatchObject({ due: 1, fresh: 15, perDay: 15 });
		// Filipino caps itself at 2; the other two split the other thirteen.
		expect(overview.decks.map((d) => [d.slug, d.due, d.fresh, d.total])).toEqual([
			['computer-science', 1, 7, 11],
			['filipino', 0, 2, 10],
			['wisdom', 0, 6, 10]
		]);
		expect(overview.decks[0].categories).toEqual([
			{ name: 'Cloud', cards: 8, ready: 7 },
			{ name: 'Web', cards: 3, ready: 1 }
		]);
	});

	it('reviews every deck in turn, one deck, or one category, the same cards each way', async () => {
		const all = await deckReview(vault, [], TODAY);
		expect(all!.cards.slice(0, 5).map((c) => c.question)).toEqual(['Old', 'cloud1', 'tl1', 'st1', 'cloud2']);
		expect(all!.cards).toHaveLength(16);

		const cs = await deckReview(vault, [], TODAY, { deck: 'computer-science' });
		expect(cs).toMatchObject({ deck: { name: 'Computer Science', slug: 'computer-science' }, category: null, total: 11 });
		expect(cs!.cards.map((c) => c.question)).toEqual(all!.cards.filter((c) => c.path.startsWith('Flashcards/Computer Science/')).map((c) => c.question));

		const web = await deckReview(vault, [], TODAY, { deck: 'computer-science', category: 'web' });
		// Its new cards wait behind Cloud's, by path, so today it is the one due.
		expect(web).toMatchObject({ category: 'Web', total: 3 });
		expect(web!.cards.map((c) => c.question)).toEqual(['Old']);

		expect(await deckReview(vault, [], TODAY, { deck: 'nope' })).toBeNull();
		expect(await deckReview(vault, [], TODAY, { deck: 'computer-science', category: 'Nope' })).toBeNull();
	});

	it('gives a deck that began its share this morning none of what is left', async () => {
		for (let i = 0; i < 5; i++) await recordIntroduced(vault, await cardPools(vault, []), 'Flashcards/Wisdom/Stoicism (cards).md', TODAY);
		const { decks: views, fresh } = await flashcardsOverview(vault, [], TODAY);
		expect(fresh).toBe(10);
		expect(views.map((d) => d.fresh)).toEqual([7, 2, 1]);
	});

	it('has nothing to review with no decks', async () => {
		expect(await flashcardsOverview(vault, [], TODAY).then((o) => o.decks.length)).toBe(3);
		for (const name of ['Computer Science', 'Filipino', 'Wisdom']) await vault.remove(`Glossaries/${name}.md`);
		expect(await flashcardsOverview(vault, [], TODAY)).toEqual({ decks: [], due: 0, fresh: 0, perDay: 15 });
	});
});

describe('new cards a day', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-per-day-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('is fifteen until the settings say otherwise', async () => {
		expect(await newCardsPerDay(vault)).toBe(15);
		await vault.write(FLASHCARD_SETTINGS_PATH, '---\nnew_per_day: lots\n---\n');
		expect(await newCardsPerDay(vault)).toBe(15);
		await vault.write(FLASHCARD_SETTINGS_PATH, '---\nnew_per_day: "8"\n---\n');
		expect(await newCardsPerDay(vault)).toBe(8);
	});

	it('creates the settings file, then changes only its one line', async () => {
		expect(await setNewCardsPerDay(vault, 12)).toEqual({ ok: true, perDay: 12 });
		expect(await newCardsPerDay(vault)).toBe(12);

		await vault.write(FLASHCARD_SETTINGS_PATH, '---\ntheme: x\nnew_per_day: 12\n---\n\nMy notes.\n');
		expect(await setNewCardsPerDay(vault, '0')).toEqual({ ok: true, perDay: 0 });
		expect((await vault.read(FLASHCARD_SETTINGS_PATH)).content).toBe('---\ntheme: x\nnew_per_day: 0\n---\n\nMy notes.\n');
	});

	it.each([[-1], [2.5], [501], ['ten'], [null]])('refuses %s', async (value) => {
		expect(await setNewCardsPerDay(vault, value)).toEqual({ ok: false, reason: 'invalid' });
		expect((await vault.read(FLASHCARD_SETTINGS_PATH)).exists).toBe(false);
	});
});

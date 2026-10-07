import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { cardPools, deckReview, decks, FLASHCARD_SETTINGS_PATH, flashcardSettings, flashcardsOverview, setFlashcardSettings } from './decks';
import { recordIntroduced } from './new-cards';

const TODAY = '2026-09-30';

/** Web's card file: one reviewed card, `Old`, due on `due`, and two new ones. */
const web = (due: string) => `#flashcards\n\nOld::due\n<!--SR:!${due},4,250-->\n\n${cards('web', 2).slice('#flashcards\n\n'.length)}`;

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
		await vault.write('Flashcards/Computer Science/Web (cards).md', web('2026-09-30'));
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
		expect((await cardPools(vault, [])).map((p) => [p.scope, p.perDay])).toEqual([
			['Flashcards/Computer Science', null],
			['Flashcards/Filipino', 2],
			['Flashcards/Wisdom', null]
		]);
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
			{ name: 'Cloud', key: 'Computer Science/Cloud', cards: 8, ready: 7, focused: false },
			{ name: 'Web', key: 'Computer Science/Web', cards: 3, ready: 1, focused: false }
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
		for (let i = 0; i < 5; i++) await recordIntroduced(vault, 'Flashcards/Wisdom/Stoicism (cards).md', TODAY);
		const { decks: views, fresh } = await flashcardsOverview(vault, [], TODAY);
		expect(fresh).toBe(10);
		expect(views.map((d) => d.fresh)).toEqual([7, 2, 1]);
	});

	it('has nothing to review with no decks', async () => {
		expect(await flashcardsOverview(vault, [], TODAY).then((o) => o.decks.length)).toBe(3);
		for (const name of ['Computer Science', 'Filipino', 'Wisdom']) await vault.remove(`Glossaries/${name}.md`);
		expect(await flashcardsOverview(vault, [], TODAY)).toEqual({ decks: [], due: 0, fresh: 0, held: 0, perDay: 15, focus: [] });
	});

	it('holds a new card back for each review overdue, so a missed day adds none', async () => {
		const path = 'Flashcards/Computer Science/Web (cards).md';
		await vault.write(path, web('2026-09-28'), (await vault.read(path)).hash);
		expect(await flashcardsOverview(vault, [], TODAY)).toMatchObject({ due: 1, fresh: 14, held: 1 });
	});
});

describe('a focus on new cards', () => {
	let root: string;
	let vault: Vault;
	const settings = (frontmatter: string) => vault.write(FLASHCARD_SETTINGS_PATH, `---\n${frontmatter}\n---\n`, undefined);
	const fresh = async () => (await flashcardsOverview(vault, [], TODAY)).decks.map((d) => d.fresh);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-focus-'));
		vault = new Vault(root);
		await vault.write('Glossaries/Computer Science.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Glossaries/Filipino.md', '---\nflashcards: true\nnew_per_day: 2\n---\n# Glossary\n');
		await vault.write('Glossaries/Wisdom.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Flashcards/Computer Science/Cloud (cards).md', cards('cloud', 8));
		await vault.write('Flashcards/Computer Science/Web (cards).md', web(TODAY));
		await vault.write('Flashcards/Filipino/Tagalog (cards).md', cards('tl', 10));
		await vault.write('Flashcards/Wisdom/Stoicism (cards).md', cards('st', 10));
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('offers new cards only from the focused categories, ignoring a deck’s own cap', async () => {
		await settings('focus:\n  - Computer Science/Cloud\n  - Filipino/Tagalog');
		const overview = await flashcardsOverview(vault, [], TODAY);
		// Cloud has eight to give; Tagalog takes the rest of fifteen past its cap of two.
		expect(overview).toMatchObject({ fresh: 15, focus: ['Computer Science/Cloud', 'Filipino/Tagalog'] });
		expect(overview.decks.map((d) => d.fresh)).toEqual([8, 7, 0]);
		expect(overview.decks[0].categories.map((c) => [c.name, c.focused])).toEqual([['Cloud', true], ['Web', false]]);
		expect(await deckReview(vault, [], TODAY).then((r) => r!.cards.filter((c) => c.schedule === null).map((c) => c.question).slice(0, 4))).toEqual(['cloud1', 'tl1', 'cloud2', 'tl2']);
	});

	it('shares evenly per category, whichever glossary each is in', async () => {
		await settings('new_per_day: 4\nfocus:\n  - Computer Science/Cloud\n  - Wisdom/Stoicism');
		expect(await fresh()).toEqual([2, 0, 2]);
		await settings('new_per_day: 6\nfocus:\n  - Computer Science/Cloud\n  - Computer Science/Web\n  - Wisdom/Stoicism');
		// Web has two new cards, Cloud and Stoicism two each.
		expect(await fresh()).toEqual([4, 0, 2]);
	});

	it('gives fewer new cards when the focused categories run out, the other decks not filling in', async () => {
		await settings('focus:\n  - Computer Science/Web');
		expect(await flashcardsOverview(vault, [], TODAY)).toMatchObject({ due: 1, fresh: 2 });
	});

	it('ignores an item matching no category, and no focus when none match', async () => {
		await settings('focus:\n  - Gone/Nope\n  - Wisdom/Stoicism');
		expect(await flashcardsOverview(vault, [], TODAY)).toMatchObject({ fresh: 10, focus: ['Wisdom/Stoicism'] });
		await settings('focus:\n  - Gone/Nope');
		expect(await flashcardsOverview(vault, [], TODAY)).toMatchObject({ fresh: 15, focus: [] });
		expect(await fresh()).toEqual([7, 2, 6]);
	});

	it('keeps the day’s total when the focus changes after first reviews', async () => {
		for (let i = 0; i < 5; i++) await recordIntroduced(vault, 'Flashcards/Wisdom/Stoicism (cards).md', TODAY);
		await settings('focus:\n  - Filipino/Tagalog');
		expect(await fresh()).toEqual([0, 10, 0]);
	});

	it('still has the reviews due from categories out of focus', async () => {
		await settings('focus:\n  - Wisdom/Stoicism');
		const overview = await flashcardsOverview(vault, [], TODAY);
		expect(overview.due).toBe(1);
		expect(overview.decks[0].categories.find((c) => c.name === 'Web')).toMatchObject({ ready: 1, focused: false });
	});
});

describe('the settings', () => {
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

	it('is fifteen and no focus until the settings say otherwise', async () => {
		expect(await flashcardSettings(vault)).toEqual({ perDay: 15, focus: [] });
		await vault.write(FLASHCARD_SETTINGS_PATH, '---\nnew_per_day: lots\n---\n');
		expect((await flashcardSettings(vault)).perDay).toBe(15);
		await vault.write(FLASHCARD_SETTINGS_PATH, '---\nnew_per_day: "8"\nfocus:\n  - A/B\n  - C/D\n---\n');
		expect(await flashcardSettings(vault)).toEqual({ perDay: 8, focus: ['A/B', 'C/D'] });
	});

	it('creates the settings file, then changes only its one line', async () => {
		expect(await setFlashcardSettings(vault, [], { perDay: 12 })).toEqual({ ok: true, perDay: 12, focus: [] });
		expect((await flashcardSettings(vault)).perDay).toBe(12);

		await vault.write(FLASHCARD_SETTINGS_PATH, '---\ntheme: x\nnew_per_day: 12\n---\n\nMy notes.\n');
		expect(await setFlashcardSettings(vault, [], { perDay: '0' })).toEqual({ ok: true, perDay: 0, focus: [] });
		expect((await vault.read(FLASHCARD_SETTINGS_PATH)).content).toBe('---\ntheme: x\nnew_per_day: 0\n---\n\nMy notes.\n');
	});

	it.each([[-1], [2.5], [501], ['ten'], [null]])('refuses %s a day', async (value) => {
		expect(await setFlashcardSettings(vault, [], { perDay: value })).toEqual({ ok: false, reason: 'invalid' });
		expect((await vault.read(FLASHCARD_SETTINGS_PATH)).exists).toBe(false);
	});

	describe('the focus', () => {
		beforeEach(async () => {
			await vault.write('Glossaries/Networks.md', '---\nflashcards: true\n---\n# Glossary\n');
			await vault.write('Flashcards/Networks/Protocols (cards).md', cards('p', 2));
			await vault.write('Flashcards/Networks/Naming (cards).md', cards('n', 2));
		});

		it('is written as a list beside the number a day, every other byte kept, and cleared with none', async () => {
			await vault.write(FLASHCARD_SETTINGS_PATH, '---\ntheme: x\nnew_per_day: 9\n---\n\nMy notes.\n');
			expect(await setFlashcardSettings(vault, [], { focus: ['Networks/Protocols', 'Networks/Naming'] })).toEqual({
				ok: true,
				perDay: 9,
				focus: ['Networks/Protocols', 'Networks/Naming']
			});
			expect((await vault.read(FLASHCARD_SETTINGS_PATH)).content).toBe(
				'---\ntheme: x\nnew_per_day: 9\nfocus:\n  - Networks/Protocols\n  - Networks/Naming\n---\n\nMy notes.\n'
			);
			expect(await setFlashcardSettings(vault, [], { focus: [] })).toMatchObject({ ok: true, focus: [] });
			expect((await vault.read(FLASHCARD_SETTINGS_PATH)).content).toBe('---\ntheme: x\nnew_per_day: 9\nfocus:\n---\n\nMy notes.\n');
		});

		it('creates the file with just the focus, the number a day left to its default', async () => {
			expect(await setFlashcardSettings(vault, [], { focus: ['Networks/Naming'] })).toEqual({ ok: true, perDay: 15, focus: ['Networks/Naming'] });
			expect((await vault.read(FLASHCARD_SETTINGS_PATH)).content).toMatch(/^---\nfocus:\n {2}- Networks\/Naming\n---\n/);
		});

		it.each([[['Networks/Nope']], [['Nope/Naming']], ['Networks/Naming'], [[3]], [null]])('refuses %j', async (focus) => {
			expect(await setFlashcardSettings(vault, [], { focus })).toEqual({ ok: false, reason: 'invalid' });
			expect((await vault.read(FLASHCARD_SETTINGS_PATH)).exists).toBe(false);
		});

		it('refuses nothing to change', async () => {
			expect(await setFlashcardSettings(vault, [], {})).toEqual({ ok: false, reason: 'invalid' });
		});
	});
});

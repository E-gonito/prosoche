import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '$server/index/index';
import { Vault } from '$server/vault/index';
import { loadWorkspaces } from '$server/workspaces';
import { loadSubjects } from '$server/study/subjects';
import { TODAY_CARDS, todayCards } from './today.server';
import { MODULES } from './index';
import type { Hub } from '$server/hub';

/**
 * `docs/plan-rebuild.md`'s rule for Today's module cards: a private module
 * (Date, the only one) contributes nothing anywhere but its own screen.
 * Rather than trust every future contributor to remember that by hand, this
 * runs every one of them against a fixture vault and checks the module each
 * names against the registry itself.
 */
describe('TODAY_CARDS never names a private module', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-today-cards-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('Glossaries/Computer Science.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Flashcards/Computer Science/Theory (cards).md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs);
		}
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	const fakeHub = (): Hub => ({
		vault,
		index,
		workspace: async () => null,
		subscribe: () => () => {},
		rebuild: async () => 0,
		workspaces: async () => loadWorkspaces(vault),
		subjects: async () => loadSubjects(vault)
	});

	it('produces cards whose module is never marked private in MODULES', async () => {
		const ctx = { day: '2026-09-29', hub: fakeHub() };
		const cards = await todayCards(ctx);
		expect(cards.length).toBeGreaterThan(0);
		for (const card of cards) {
			const module = MODULES.find((m) => m.id === card.module);
			expect(module?.private).not.toBe(true);
		}
	});

	it('checks every registered contributor individually, not just the ones with something to say', async () => {
		const ctx = { day: '2026-09-29', hub: fakeHub() };
		for (const contribute of TODAY_CARDS) {
			const card = await contribute(ctx);
			if (!card) continue;
			const module = MODULES.find((m) => m.id === card.module);
			expect(module?.private).not.toBe(true);
		}
	});
});

describe('flashcardsDue, the one shipped contributor', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-today-flash-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	const fakeHub = (): Hub => ({
		vault,
		index,
		workspace: async () => null,
		subscribe: () => () => {},
		rebuild: async () => 0,
		workspaces: async () => loadWorkspaces(vault),
		subjects: async () => loadSubjects(vault)
	});

	it('is absent when nothing is due', async () => {
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards).toEqual([]);
	});

	it('gives one line for every deck together, linking to the mixed review, once something is due', async () => {
		await vault.write('Glossaries/Computer Science.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Glossaries/Filipino.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Flashcards/Computer Science/Theory (cards).md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		await vault.write('Flashcards/Filipino/Words (cards).md', '#flashcards\n\nAso::Dog\n');
		await vault.write('Study/Cards.md', '#flashcards\n\nNot::a deck\n');
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({ module: 'flashcards', href: '/flashcards' });
		// One line for both decks; the card in no deck is not counted.
		expect(cards[0].items).toEqual([{ text: '2 cards to review', meta: '2 new today', href: '/flashcards/review' }]);
	});

	it('counts only the day’s new cards, as the Flashcards page does', async () => {
		await vault.write('_hub/flashcards.md', '---\nnew_per_day: 1\n---\n');
		await vault.write('Glossaries/Computer Science.md', '---\nflashcards: true\n---\n# Glossary\n');
		await vault.write('Flashcards/Computer Science/Theory (cards).md', '#flashcards\n\nWhat is Big O::A growth bound\n\nWhat is Big Theta::A tight bound\n');
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards[0].items).toEqual([{ text: '1 card to review', meta: '1 new today', href: '/flashcards/review' }]);
	});

	it('counts nothing when no glossary makes cards, whatever else holds some', async () => {
		await vault.write('Glossaries/Computer Science.md', '# Glossary\n');
		await vault.write('Flashcards/Computer Science/Theory (cards).md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		expect(await todayCards({ day: '2026-09-29', hub: fakeHub() })).toEqual([]);
	});
});

describe('studyNext', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-today-study-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('_hub/subjects/cs.md', '---\nname: CS\nfolders:\n  - Study/CS\n---\n');
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	const fakeHub = (): Hub => ({
		vault,
		index,
		workspace: async () => null,
		subscribe: () => () => {},
		rebuild: async () => 0,
		workspaces: async () => loadWorkspaces(vault),
		subjects: async () => loadSubjects(vault)
	});
	const study = async (day = '2026-10-02') => (await todayCards({ day, hub: fakeHub() })).find((c) => c.module === 'study');

	it('is absent when no subject has a step open', async () => {
		expect(await study()).toBeUndefined();
		await vault.write('Study/CS/Goals.md', '## Networks\n- [x] TCP\n');
		expect(await study()).toBeUndefined();
	});

	it('gives the step to do now in the goal in focus, which step it is and when it is due', async () => {
		await vault.write('Study/CS/Goals.md', '## Done\n- [x] all\n\n## Networks\n- [x] TCP\n- [ ] `dig` a DNS name 📅 2026-10-11\n- [ ] BGP\n');
		expect(await study()).toEqual({
			module: 'study',
			title: 'Study next',
			href: '/study',
			items: [{ text: 'dig a DNS name', meta: 'Networks · step 2 of 3 · due 11 Oct', href: '/study/cs' }]
		});
	});

	it('says late once the step’s day has passed, and names subjects when there are several', async () => {
		await vault.write('Study/CS/Goals.md', '## Networks\n- [ ] DNS 📅 2026-09-30\n');
		await vault.write('_hub/subjects/fil.md', '---\nname: Filipino\nfolders:\n  - Study/Filipino\n---\n');
		await vault.write('Study/Filipino/Goals.md', '---\nfocus: Verbs\n---\n## Nouns\n- [ ] aso\n\n## Verbs\n- [ ] kumain\n');
		const card = await study();
		expect(card?.items.map((i) => [i.text, i.meta])).toEqual([
			['DNS', 'CS · Networks · step 1 of 1 · late, due 30 Sept'],
			['kumain', 'Filipino · Verbs · step 1 of 1']
		]);
	});
});

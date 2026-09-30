import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '$server/index/index';
import { Vault } from '$server/vault/index';
import { loadWorkspaces } from '$server/workspaces';
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
		await vault.write('Study/Algorithms.md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		await vault.write(
			'_hub/workspaces/study.md',
			'---\nname: Study\ncolor: "#7c3aed"\ntag: ws/study\ntemplate: study\nfolders:\n  - "Study"\n---\n'
		);
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
		workspaces: async () => loadWorkspaces(vault)
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
		workspaces: async () => loadWorkspaces(vault)
	});

	it('is absent when nothing is due', async () => {
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards).toEqual([]);
	});

	it('gives one line for every subject together, linking to the mixed review, once something is due', async () => {
		await vault.write('Study/Algorithms.md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		await vault.write('Filipino/Words.md', '#flashcards\n\nAso::Dog\n');
		await vault.write('Elsewhere/Cards.md', '#flashcards\n\nNot::a subject\n');
		await vault.write('_hub/workspaces/cs.md', '---\nname: CS\ntemplate: study\nfolders:\n  - "Study"\n---\n');
		await vault.write('_hub/workspaces/fil.md', '---\nname: Filipino\ntemplate: study\nfolders:\n  - "Filipino"\n---\n');
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs);
		}
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({ module: 'study', href: '/study' });
		// One line for both subjects; the note in no subject's folders is not counted.
		expect(cards[0].items).toEqual([{ text: '2 cards to review', meta: '2 new today', href: '/study/review' }]);
	});

	it('counts only the day’s new cards, as Study does', async () => {
		await vault.write('Study/Algorithms.md', '#flashcards\n\nWhat is Big O::A growth bound\n\nWhat is Big Theta::A tight bound\n');
		await vault.write('_hub/workspaces/cs.md', '---\nname: CS\ntemplate: study\nnew_per_day: 1\nfolders:\n  - "Study"\n---\n');
		for (const path of await vault.list()) {
			const note = await vault.read(path);
			index.put(path, note.content, note.mtimeMs);
		}
		const cards = await todayCards({ day: '2026-09-29', hub: fakeHub() });
		expect(cards[0].items).toEqual([{ text: '1 card to review', meta: '1 new today', href: '/study/review' }]);
	});

	it('counts nothing when there is no subject, rather than the whole vault', async () => {
		await vault.write('Study/Algorithms.md', '#flashcards\n\nWhat is Big O::A growth bound\n');
		expect(await todayCards({ day: '2026-09-29', hub: fakeHub() })).toEqual([]);
	});
});

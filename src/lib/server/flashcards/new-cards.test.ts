import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NEW_CARDS_PATH, newCardPlan, recordIntroduced, releaseNew, type NewCardPlan } from './new-cards';
import type { Card } from '$lib/shared/flashcards';

/** An unseen card in `folder`, named by its question. */
const card = (folder: string, question: string): Card => ({
	path: `${folder}/${question}.md`,
	line: 2,
	endLine: 2,
	kind: 'inline',
	question,
	answer: '',
	context: '',
	deck: folder,
	schedule: null,
	index: 0,
	siblings: 1,
	scheduleLine: 2,
	scheduleExists: false,
	expectedRaw: ''
});

const pool = (folder: string, begun = 0, room: number | null = null) => ({ folder, begun, room });

const UNSEEN = [card('A', 'a1'), card('A', 'a2'), card('A', 'a3'), card('A', 'a4'), card('B', 'b1'), card('B', 'b2'), card('C', 'c1')];

describe('releaseNew', () => {
	it.each<[string, NewCardPlan, string[]]>([
		['shares the day out a card at a time', { left: 4, pools: [pool('A'), pool('B'), pool('C')] }, ['a1', 'a2', 'b1', 'c1']],
		['gives a pool with none left’s share to the rest', { left: 6, pools: [pool('A'), pool('B'), pool('C')] }, ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']],
		['evens out what was begun earlier today', { left: 3, pools: [pool('A', 2), pool('B'), pool('C')] }, ['b1', 'b2', 'c1']],
		['holds a pool to its own limit', { left: 5, pools: [pool('A', 0, 1), pool('B'), pool('C')] }, ['a1', 'b1', 'b2', 'c1']],
		['with no shared limit, lets each pool take up to its own', { left: Infinity, pools: [pool('A', 0, 2), pool('B', 0, 1)] }, ['a1', 'a2', 'b1']],
		['lets none in once the day is used up', { left: 0, pools: [pool('A')] }, []],
		['lets in nothing outside every pool', { left: 5, pools: [pool('Z')] }, []]
	])('%s', (_name, plan, expected) => {
		expect([...releaseNew(plan, UNSEEN)].map((c) => c.question).sort()).toEqual(expected);
	});
});

describe('the day’s count of first reviews', () => {
	let root: string;
	let vault: Vault;
	const TODAY = '2026-09-30';
	const POOLS = [
		{ key: 'deck/cs', folder: 'Flashcards/CS', perDay: null },
		{ key: 'deck/fil', folder: 'Flashcards/Filipino', perDay: 4 }
	];

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-new-cards-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('counts a first review for the pool holding it, and only today', async () => {
		await recordIntroduced(vault, POOLS, 'Flashcards/CS/Cloud (cards).md', TODAY);
		await recordIntroduced(vault, POOLS, 'Flashcards/CS/Web (cards).md', TODAY);
		await recordIntroduced(vault, POOLS, 'Flashcards/Filipino/Words (cards).md', TODAY);
		await recordIntroduced(vault, POOLS, 'Elsewhere/Cards.md', TODAY);
		expect(JSON.parse((await vault.read(NEW_CARDS_PATH)).content)).toEqual({ day: TODAY, introduced: { 'deck/cs': 2, 'deck/fil': 1 } });

		expect(await newCardPlan(vault, POOLS, TODAY, 15)).toEqual({ left: 12, pools: [pool('Flashcards/CS', 2), pool('Flashcards/Filipino', 1, 3)] });
		expect((await newCardPlan(vault, POOLS, TODAY)).left).toBe(Infinity);
		expect((await newCardPlan(vault, POOLS, '2026-10-01', 15)).left).toBe(15);

		// A new day starts the count again rather than adding to yesterday's.
		await recordIntroduced(vault, POOLS, 'Flashcards/CS/Cloud (cards).md', '2026-10-01');
		expect(JSON.parse((await vault.read(NEW_CARDS_PATH)).content)).toEqual({ day: '2026-10-01', introduced: { 'deck/cs': 1 } });
	});

	it('reads a file it cannot parse as nothing begun', async () => {
		await vault.write(NEW_CARDS_PATH, 'not json');
		expect((await newCardPlan(vault, POOLS, TODAY, 15)).left).toBe(15);
	});
});

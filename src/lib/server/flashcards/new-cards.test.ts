import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { inScope, NEW_CARDS_PATH, newCardPlan, recordIntroduced, releaseNew, type NewCardPlan } from './new-cards';
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

const pool = (scope: string, begun = 0, room: number | null = null) => ({ scope, begun, room });

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
		const { cards, held } = releaseNew(plan, UNSEEN);
		expect([...cards].map((c) => c.question).sort()).toEqual(expected);
		expect(held).toBe(0);
	});

	it.each<[string, number, NewCardPlan, string[], number]>([
		['holds back the last card let in for each review overdue', 2, { left: 4, pools: [pool('A'), pool('B'), pool('C')] }, ['a1', 'b1'], 2],
		['holds back no more than would have joined', 9, { left: 4, pools: [pool('A'), pool('B'), pool('C')] }, [], 4],
		['holds back from what joins, not from the allowance', 2, { left: 15, pools: [pool('B'), pool('C')] }, ['b1'], 2],
		['with nothing overdue, holds nothing back', 0, { left: 2, pools: [pool('A')] }, ['a1', 'a2'], 0]
	])('%s', (_name, overdue, plan, expected, held) => {
		const out = releaseNew(plan, UNSEEN, overdue);
		expect([...out.cards].map((c) => c.question).sort()).toEqual(expected);
		expect(out.held).toBe(held);
	});
});

describe('inScope', () => {
	it.each<[string, string, string, boolean]>([
		['a path inside a folder', 'A/B/c.md', 'A/B', true],
		['a folder given with a trailing slash', 'A/B/c.md', 'A/B/', true],
		['a card file as its own scope', 'A/B/c (cards).md', 'A/B/c (cards).md', true],
		['a sibling folder sharing a prefix', 'A/Bc/d.md', 'A/B', false],
		['another card file', 'A/B/d (cards).md', 'A/B/c (cards).md', false]
	])('%s', (_name, path, scope, expected) => {
		expect(inScope(path, scope)).toBe(expected);
	});
});

describe('the day’s count of first reviews', () => {
	let root: string;
	let vault: Vault;
	const TODAY = '2026-09-30';
	const POOLS = [
		{ scope: 'Flashcards/CS', perDay: null },
		{ scope: 'Flashcards/Filipino', perDay: 4 }
	];
	const CLOUD = 'Flashcards/CS/Cloud (cards).md';
	const WEB = 'Flashcards/CS/Web (cards).md';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-new-cards-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('counts a first review for the card file holding it, and only today', async () => {
		await recordIntroduced(vault, CLOUD, TODAY);
		await recordIntroduced(vault, WEB, TODAY);
		await recordIntroduced(vault, CLOUD, TODAY);
		await recordIntroduced(vault, 'Flashcards/Filipino/Words (cards).md', TODAY);
		expect(JSON.parse((await vault.read(NEW_CARDS_PATH)).content)).toEqual({
			day: TODAY,
			introduced: { [CLOUD]: 2, [WEB]: 1, 'Flashcards/Filipino/Words (cards).md': 1 }
		});

		// A pool has begun the files inside its scope; the day's total is every file.
		expect(await newCardPlan(vault, POOLS, TODAY, 15)).toEqual({ left: 11, pools: [pool('Flashcards/CS', 3), pool('Flashcards/Filipino', 1, 3)] });
		expect((await newCardPlan(vault, POOLS, TODAY)).left).toBe(Infinity);
		expect((await newCardPlan(vault, POOLS, '2026-10-01', 15)).left).toBe(15);

		// A new day starts the count again rather than adding to yesterday's.
		await recordIntroduced(vault, CLOUD, '2026-10-01');
		expect(JSON.parse((await vault.read(NEW_CARDS_PATH)).content)).toEqual({ day: '2026-10-01', introduced: { [CLOUD]: 1 } });
	});

	it('keeps the day’s total when the pools change, a card file as a scope matching only itself', async () => {
		await recordIntroduced(vault, CLOUD, TODAY);
		await recordIntroduced(vault, WEB, TODAY);
		// Pools by category each begin their own file's one; the total is still two.
		const byCategory = [CLOUD, WEB].map((scope) => ({ scope, perDay: null }));
		expect(await newCardPlan(vault, byCategory, TODAY, 15)).toEqual({ left: 13, pools: [pool(CLOUD, 1), pool(WEB, 1)] });
		// An older file's counts, kept per deck, still count against the day.
		await vault.write(NEW_CARDS_PATH, JSON.stringify({ day: TODAY, introduced: { 'deck/cs': 4, [CLOUD]: 1 } }));
		expect(await newCardPlan(vault, byCategory, TODAY, 15)).toMatchObject({ left: 10 });
	});

	it('reads a file it cannot parse as nothing begun', async () => {
		await vault.write(NEW_CARDS_PATH, 'not json');
		expect((await newCardPlan(vault, POOLS, TODAY, 15)).left).toBe(15);
	});
});

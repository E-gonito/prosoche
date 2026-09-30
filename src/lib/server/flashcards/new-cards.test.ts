import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { newCardsPerDay, releaseNew, setNewCardsPerDay, STUDY_SETTINGS_PATH, type NewCardPlan } from './new-cards';
import type { Card } from '$lib/shared/study';

/** An unseen card in `folder`, named by its question. */
const card = (folder: string, question: string): { card: Card; tags: string[] } => ({
	card: {
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
	},
	tags: []
});

const subject = (folder: string, begun = 0, room: number | null = null) => ({ scope: { folders: [folder] }, begun, room });

const UNSEEN = [card('A', 'a1'), card('A', 'a2'), card('A', 'a3'), card('A', 'a4'), card('B', 'b1'), card('B', 'b2'), card('C', 'c1')];

describe('releaseNew', () => {
	it.each<[string, NewCardPlan, string[]]>([
		['shares the day out a card at a time', { left: 4, subjects: [subject('A'), subject('B'), subject('C')] }, ['a1', 'a2', 'b1', 'c1']],
		['gives a subject with none left’s share to the rest', { left: 6, subjects: [subject('A'), subject('B'), subject('C')] }, ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']],
		['evens out what was begun earlier today', { left: 3, subjects: [subject('A', 2), subject('B'), subject('C')] }, ['b1', 'b2', 'c1']],
		['holds a subject to its own cap', { left: 5, subjects: [subject('A', 0, 1), subject('B'), subject('C')] }, ['a1', 'b1', 'b2', 'c1']],
		['lets none in once the day is used up', { left: 0, subjects: [subject('A')] }, []],
		['lets in nothing outside every subject', { left: 5, subjects: [subject('Z')] }, []],
		['lets a card two subjects share in once', { left: 2, subjects: [subject('A'), { scope: { folders: ['A', 'B'] }, begun: 0, room: null }] }, ['a1', 'a2']]
	])('%s', (_name, plan, expected) => {
		expect([...releaseNew(plan, UNSEEN)].map((c) => c.question).sort()).toEqual(expected);
	});
});

describe('new cards a day', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-new-cards-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('is fifteen until the settings say otherwise', async () => {
		expect(await newCardsPerDay(vault)).toBe(15);
		await vault.write(STUDY_SETTINGS_PATH, '---\nnew_per_day: lots\n---\n');
		expect(await newCardsPerDay(vault)).toBe(15);
		await vault.write(STUDY_SETTINGS_PATH, '---\nnew_per_day: "8"\n---\n');
		expect(await newCardsPerDay(vault)).toBe(8);
	});

	it('creates the settings file, then changes only its one line', async () => {
		expect(await setNewCardsPerDay(vault, 12)).toEqual({ ok: true, perDay: 12 });
		expect(await newCardsPerDay(vault)).toBe(12);

		await vault.write(STUDY_SETTINGS_PATH, '---\ntheme: x\nnew_per_day: 12 # mine\n---\n\nMy notes.\n');
		expect(await setNewCardsPerDay(vault, '0')).toEqual({ ok: true, perDay: 0 });
		expect((await vault.read(STUDY_SETTINGS_PATH)).content).toBe('---\ntheme: x\nnew_per_day: 0\n---\n\nMy notes.\n');
	});

	it.each([[-1], [2.5], [501], ['ten'], [null]])('refuses %s', async (value) => {
		expect(await setNewCardsPerDay(vault, value)).toEqual({ ok: false, reason: 'invalid' });
		expect((await vault.read(STUDY_SETTINGS_PATH)).exists).toBe(false);
	});
});

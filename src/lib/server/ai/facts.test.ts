import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import {
	FACTS_TOKEN_CAP,
	factCounts,
	gatherWorkspaceFacts,
	renderFacts,
	type WorkspaceFacts
} from './facts';
import type { Workspace } from '../workspaces';
import type { WeekSummary } from '../timelog';
import { estimateTokens } from '$lib/shared/ai';

const WEEK = [
	'2026-09-21',
	'2026-09-22',
	'2026-09-23',
	'2026-09-24',
	'2026-09-25',
	'2026-09-26',
	'2026-09-27'
];

function summary(over: Partial<WeekSummary> = {}): WeekSummary {
	return {
		days: WEEK.map((day) => ({ day, plannedMinutes: 0, doneMinutes: 0, loggedMinutes: 0 })),
		plannedMinutes: 0,
		doneMinutes: 0,
		loggedMinutes: 0,
		byWorkspace: [],
		byQuadrant: [],
		unmatched: [],
		scoped: true,
		...over
	};
}

function facts(over: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
	return {
		slug: 'eye2gene',
		name: 'eye2gene',
		day: '2026-09-22',
		week: WEEK,
		summary: summary(),
		columns: [],
		overdue: [],
		blocked: [],
		blocks: [],
		notes: [],
		...over
	};
}

const DECK = 'Work Projects/eye2gene/Tasks.md';

describe('renderFacts', () => {
	it('writes the whole block, one line per item', () => {
		const days = summary().days.map((d) =>
			d.day === '2026-09-21'
				? { day: d.day, plannedMinutes: 90, doneMinutes: 90, loggedMinutes: 0 }
				: d.day === '2026-09-22'
					? { day: d.day, plannedMinutes: 450, doneMinutes: 0, loggedMinutes: 65 }
					: d
		);
		const text = renderFacts(
			facts({
				summary: summary({ days, plannedMinutes: 540, doneMinutes: 90, loggedMinutes: 65 }),
				columns: [
					{
						title: 'To do',
						count: 2,
						cards: [
							{ text: 'Fix the importer', due: '2026-09-20', quadrant: 1, blockedBy: [], path: DECK },
							{ text: 'Write the release notes', due: null, quadrant: null, blockedBy: [], path: DECK }
						]
					},
					{
						title: 'In progress',
						count: 1,
						cards: [{ text: 'Rework the schema', due: null, quadrant: 2, blockedBy: [], path: DECK }]
					}
				],
				overdue: [{ text: 'Fix the importer', due: '2026-09-20', quadrant: 1, blockedBy: [], path: DECK }],
				blocked: [{ text: 'Ship the release', due: null, quadrant: null, blockedBy: ['e2g-4'], path: DECK }],
				blocks: [
					{ day: '2026-09-21', text: 'Work on eye2gene', plannedMinutes: 90, done: true },
					{ day: '2026-09-22', text: 'Work on eye2gene', plannedMinutes: 450, done: false },
					{ day: '2026-09-22', text: 'Read the protocol', plannedMinutes: 0, done: false }
				],
				notes: [
					{ path: DECK, title: 'Tasks' },
					{ path: 'Work Projects/eye2gene/Spec.md', title: 'Spec' }
				]
			})
		);

		expect(text).toBe(
			[
				'# eye2gene, computed from the notes on 2026-09-22',
				'',
				'## This week (2026-09-21 to 2026-09-27)',
				'- 1h30m done and 1h5m timed, of 9h planned.',
				'- Mon 2026-09-21: 1h30m planned, 1h30m done, 0m timed.',
				'- Tue 2026-09-22: 7h30m planned, 0m done, 1h5m timed.',
				'',
				'## Open cards (3)',
				'### To do (2)',
				'- Fix the importer — due 2026-09-20 — Q1',
				'- Write the release notes',
				'### In progress (1)',
				'- Rework the schema — Q2',
				'',
				'## Overdue (1)',
				'- Fix the importer — due 2026-09-20 — Q1 — Work Projects/eye2gene/Tasks.md',
				'',
				'## Blocked (1)',
				'- Ship the release — waiting on e2g-4 — Work Projects/eye2gene/Tasks.md',
				'',
				'## Blocks this week (3)',
				'- Mon 2026-09-21: Work on eye2gene — 1h30m — done',
				'- Tue 2026-09-22: Work on eye2gene — 7h30m — not done',
				'- Tue 2026-09-22: Read the protocol — not done',
				'',
				'## Recently changed notes (2)',
				'- Tasks — Work Projects/eye2gene/Tasks.md',
				'- Spec — Work Projects/eye2gene/Spec.md',
				''
			].join('\n')
		);
	});

	it('says an empty workspace is empty in one line, with no bare headings', () => {
		expect(renderFacts(facts())).toBe(
			[
				'# eye2gene, computed from the notes on 2026-09-22',
				'',
				'Nothing planned, nothing open, and no notes changed recently.',
				''
			].join('\n')
		);
	});

	it('leaves out a section that has nothing in it', () => {
		const text = renderFacts(
			facts({ notes: [{ path: 'Work Projects/eye2gene/Spec.md', title: 'Spec' }] })
		);
		expect(text).toContain('## Recently changed notes (1)');
		expect(text).not.toContain('## Open cards');
		expect(text).not.toContain('## This week');
		expect(text).not.toContain('Nothing planned');
	});

	it('truncates long lists with "and N more" rather than going over the cap', () => {
		const card = (i: number) => ({
			text: `Card number ${i}, with a title long enough that a list of them costs real money to say`,
			due: '2026-09-20',
			quadrant: 1,
			blockedBy: [],
			path: DECK
		});
		const column = (title: string, count: number) => ({
			title,
			count,
			cards: Array.from({ length: 8 }, (_, i) => card(i))
		});
		const text = renderFacts(
			facts({
				columns: [
					column('To do', 400),
					column('In progress', 40),
					column('Blocked', 12),
					column('Waiting on someone', 30),
					column('Ideas', 90)
				],
				overdue: Array.from({ length: 50 }, (_, i) => card(i)),
				blocked: Array.from({ length: 50 }, (_, i) => ({ ...card(i), blockedBy: ['e2g-4', 'e2g-5'] })),
				blocks: Array.from({ length: 60 }, (_, i) => ({
					day: WEEK[i % 7],
					text: `A block of work whose words go on for a good while before they stop, number ${i}`,
					plannedMinutes: 90,
					done: i % 2 === 0
				})),
				notes: Array.from({ length: 10 }, (_, i) => ({
					path: `Work Projects/eye2gene/A note with a long enough name ${i}.md`,
					title: `A note with a long enough name ${i}`
				}))
			})
		);

		expect(estimateTokens(text)).toBeLessThanOrEqual(FACTS_TOKEN_CAP);
		expect(text).toContain('## Open cards (572)');
		// The lists were cut below the eight a column normally shows, and what
		// was cut is stated rather than quietly dropped.
		const lines = text.split('\n');
		const at = lines.indexOf('### To do (400)');
		const shown = lines.slice(at + 1).findIndex((line) => line.startsWith('- and '));
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(8);
		expect(lines[at + 1 + shown]).toBe(`- and ${400 - shown} more.`);
		// Every section survives the cut; only the lists inside them shrink.
		for (const heading of ['## Overdue (50)', '## Blocked (50)', '## Blocks this week (60)']) {
			expect(text).toContain(heading);
		}
	});

	it('clips a card whose text is a paragraph, so a line stays a line', () => {
		const text = renderFacts(
			facts({
				columns: [
					{
						title: 'To do',
						count: 1,
						cards: [{ text: 'x'.repeat(400), due: null, quadrant: null, blockedBy: [], path: DECK }]
					}
				]
			})
		);
		expect(text.split('\n').every((line) => line.length <= 120)).toBe(true);
		expect(text).toContain('…');
	});
});

describe('factCounts', () => {
	it('counts the true column sizes, not the lines that were shown', () => {
		expect(
			factCounts(
				facts({
					columns: [{ title: 'To do', count: 400, cards: [] }],
					overdue: [{ text: 'a', due: '2026-09-01', quadrant: null, blockedBy: [], path: DECK }],
					blocks: [{ day: '2026-09-21', text: 'a', plannedMinutes: 60, done: true }],
					summary: summary({ doneMinutes: 90, loggedMinutes: 30 })
				})
			)
		).toEqual({ cards: 400, overdue: 1, blocked: 0, blocks: 1, weekMinutes: 120 });
	});
});

describe('gatherWorkspaceFacts, against a vault', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;

	const EYE2GENE: Workspace = {
		slug: 'eye2gene',
		name: 'eye2gene',
		color: '#2f6fed',
		tag: 'ws/eye2gene',
		aliases: ['eye2gene'],
		folders: ['Work Projects/eye2gene'],
		template: 'project',
		tabs: [],
		deck: DECK,
		kanbanColumns: [],
		path: '_hub/workspaces/eye2gene.md'
	};
	const KAYA: Workspace = {
		...EYE2GENE,
		slug: 'kaya',
		name: 'Kaya',
		tag: 'ws/kaya',
		aliases: ['Kaya'],
		folders: ['Kaya Thai'],
		deck: 'Kaya Thai/Tasks.md',
		path: '_hub/workspaces/kaya.md'
	};
	const WORKSPACES = [EYE2GENE, KAYA];

	async function add(path: string, content: string, mtimeMs = 1000): Promise<void> {
		await vault.write(path, content);
		index.put(path, content, mtimeMs);
	}

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-facts-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');

		await add(
			DECK,
			[
				'# Tasks',
				'- [ ] Fix the importer 📅 2026-09-20 `Q1`',
				'- [/] Rework the schema `Q2`',
				'- [ ] Ship the release ⛔ e2g-4',
				'- [x] Land the migration',
				''
			].join('\n'),
			3000
		);
		await add('Work Projects/eye2gene/Spec.md', '# Spec\n\nHow the importer works.\n', 2000);
		await add('Kaya Thai/Tasks.md', '# Tasks\n- [ ] Order the menus `Q1`\n', 4000);

		// Monday and Tuesday, written the way this vault writes them: a timed
		// block naming the project in its own words, and no tag anywhere.
		await add(
			'Journal/2026/09/21.md',
			['# Tasks', '- [x] 10:30 - 12:00 Work on eye2gene `Q1`', '- [ ] 13:00 - 13:30 Walk the dog `Q2`', ''].join('\n')
		);
		await add(
			'Journal/2026/09/22.md',
			['# Tasks', '- [ ] 09:00 - 09:30 Work on eye2gene `Q1`', '- [x] 14:00 - 15:00 Work on Kaya `Q1`', ''].join('\n')
		);
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('gathers the week, the board, the lists and the notes', async () => {
		const gathered = await gatherWorkspaceFacts(
			{ vault, index, workspaces: WORKSPACES },
			EYE2GENE,
			'2026-09-22'
		);

		expect(gathered.week[0]).toBe('2026-09-21');
		// Monday's block is ticked and nobody timed it, so it counts as done.
		expect(gathered.summary.doneMinutes).toBe(90);
		expect(gathered.summary.days[1]).toEqual({
			day: '2026-09-22',
			plannedMinutes: 30,
			doneMinutes: 0,
			loggedMinutes: 0
		});

		// Every open checkbox in the deck is a card; the finished one is not.
		expect(gathered.columns.map((c) => [c.title, c.count])).toEqual([
			['To do', 2],
			['In progress', 1]
		]);
		expect(gathered.overdue.map((c) => c.text)).toEqual(['Fix the importer']);
		expect(gathered.blocked.map((c) => [c.text, c.blockedBy])).toEqual([['Ship the release', ['e2g-4']]]);

		// The Kaya block is Kaya's, and the dog is nobody's.
		expect(gathered.blocks).toEqual([
			{ day: '2026-09-21', text: 'Work on eye2gene', plannedMinutes: 90, done: true },
			{ day: '2026-09-22', text: 'Work on eye2gene', plannedMinutes: 30, done: false }
		]);

		// Most recently changed first, and only this workspace's folders.
		expect(gathered.notes.map((n) => n.path)).toEqual([DECK, 'Work Projects/eye2gene/Spec.md']);
	});

	it('renders what it gathered under the cap, with the figures in it', async () => {
		const text = renderFacts(
			await gatherWorkspaceFacts({ vault, index, workspaces: WORKSPACES }, EYE2GENE, '2026-09-22')
		);
		expect(estimateTokens(text)).toBeLessThanOrEqual(FACTS_TOKEN_CAP);
		expect(text).toContain('- Mon 2026-09-21: 1h30m planned, 1h30m done, 0m timed.');
		expect(text).toContain('- Fix the importer — due 2026-09-20 — Q1');
	});

	it('is empty, rather than everyone else\'s, for a workspace with nothing', async () => {
		const empty: Workspace = { ...EYE2GENE, slug: 'quiet', name: 'Quiet', tag: 'ws/quiet', aliases: [], folders: ['Quiet'], deck: 'Quiet/Tasks.md' };
		const gathered = await gatherWorkspaceFacts(
			{ vault, index, workspaces: [...WORKSPACES, empty] },
			empty,
			'2026-09-22'
		);
		expect(factCounts(gathered)).toEqual({ cards: 0, overdue: 0, blocked: 0, blocks: 0, weekMinutes: 0 });
		expect(renderFacts(gathered)).toContain('Nothing planned, nothing open');
	});
});

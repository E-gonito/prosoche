import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { apply, policyFor, validate, type Policy } from './proposal';
import { gather, openerPrompt, propose, render } from './briefing';
import type { Workspace } from '../workspaces';
import type { RunStamp } from '$lib/shared/ai';

const DAY = '2026-09-21';
const YESTERDAY = '2026-09-20';
const TODAY_PATH = 'Journal/2026/09/21.md';
const YESTERDAY_PATH = 'Journal/2026/09/20.md';
const DECK_PATH = 'Study/Algorithms.md';

const STAMP: RunStamp = {
	model: 'claude-sonnet-5',
	effort: 'medium',
	permission: 'read-only',
	budgetUsd: 0.25,
	timeoutSeconds: 120,
	feature: 'briefing',
	startedAt: `${DAY}T07:00:00.000Z`,
	durationMs: 2000,
	costUsd: 0.02
};

/**
 * A daily note with the user's own writing above, below and beside the
 * markers. The point of the test is that all of it survives byte for byte.
 */
const USER_NOTE = [
	'---',
	'date: 2026-09-21',
	'tags: [journal]',
	'---',
	'# [[Journal 2026]]',
	'***EXECUTE*** - *Time-block your planning*',
	'',
	'# Tasks',
	'- [ ] 09:30 - 10:00 Morning stretch `Q1`',
	'- [x] 10:40 - 18:00 Client project `Q1` ✅ 2026-09-21',
	'- [ ] Walk the dog, refill the water `Q1`',
	// A card already planned onto the day, as phase 0 writes it: the block
	// quotes the card's words and links back to it.
	'- [ ] Finish chapter 3 [[Study/Algorithms]] `Q2` #ws/study',
	'\t- what am I avoiding, and why   ',
	'',
	'## Briefing',
	'<!-- hub:briefing start -->',
	'stale text from yesterday',
	'<!-- hub:briefing end -->',
	'',
	'## Notes',
	'Something personal I wrote at 2am. Do not touch.',
	'',
	'```',
	'- [ ] fenced, not a task `Q2`',
	'```',
	'   ',
	''
].join('\n');

/**
 * A workspace's open cards, deliberately out of the order the briefing wants
 * them in: a Q1 below a Q2, a due date below none, and one card the day above
 * already plans.
 */
const DECK_NOTE = [
	'# Algorithms',
	'',
	'- [ ] Finish chapter 3 `Q2`',
	'- [ ] Order the textbook `Q2`',
	'- [ ] Write up the notes `Q2` 📅 2031-06-01',
	'- [ ] Read the appendix `Q1`',
	'- [x] Set up the reading list `Q1`',
	''
].join('\n');

/** Two workspaces, one of which has nothing open, so the empty one is dropped. */
const STUDY: Workspace = {
	slug: 'study',
	name: 'Study',
	color: '#7c3aed',
	tag: 'ws/study',
	aliases: [],
	folders: ['Study'],
	template: 'study',
	tabs: [],
	deck: 'Study/Tasks.md',
	kanbanColumns: [],
	path: '_hub/workspaces/study.md'
};
const ERRANDS: Workspace = { ...STUDY, slug: 'errands', name: 'Errands', tag: 'ws/errands', folders: ['Errands'], deck: 'Errands/Tasks.md', path: '_hub/workspaces/errands.md' };
const WORKSPACES = [STUDY, ERRANDS];

const YESTERDAY_NOTE = [
	'# Tasks',
	'- [x] 09:00 - 09:30 Something finished `Q1`',
	'- [ ] Something left over `Q2`',
	'- [ ] Another loose end `Q3`',
	''
].join('\n');

let root: string;
let undoRoot: string;
let vault: Vault;
let index: NoteIndex;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-ai-brief-'));
	undoRoot = await mkdtemp(join(tmpdir(), 'hub-ai-brief-undo-'));
	vault = new Vault(root);
	index = new NoteIndex(':memory:');
	await vault.write(TODAY_PATH, USER_NOTE);
	await vault.write(YESTERDAY_PATH, YESTERDAY_NOTE);
	index.put(TODAY_PATH, USER_NOTE);
	index.put(YESTERDAY_PATH, YESTERDAY_NOTE);
	index.put(DECK_PATH, DECK_NOTE);
});
afterEach(async () => {
	index.close();
	await vault.close();
	await rm(root, { recursive: true, force: true });
	await rm(undoRoot, { recursive: true, force: true });
});

const policy = (day = DAY): Policy =>
	policyFor('briefing', { enabled: true, blast: { maxFiles: 5, maxLineLoss: 0.3 } }, { today: day });

describe('gather', () => {
	it('finds what is scheduled today, in clock order', () => {
		const facts = gather(index, DAY, WORKSPACES);
		expect(facts.scheduled.map((t) => t.startMin)).toEqual([570, 640]);
	});

	it('finds what yesterday left unfinished, and not what it finished', () => {
		const texts = gather(index, DAY, WORKSPACES).unfinished.map((t) => t.text);
		expect(texts.some((t) => t.includes('Something left over'))).toBe(true);
		expect(texts.some((t) => t.includes('Something finished'))).toBe(false);
	});

	it('does not count a fenced checklist line as a task', () => {
		expect(gather(index, DAY, WORKSPACES).scheduled.every((t) => !t.fenced)).toBe(true);
	});

	it('offers each workspace its three most urgent open cards', () => {
		const groups = gather(index, DAY, WORKSPACES).fromWorkspaces;
		expect(groups.map((g) => g.workspace.slug)).toEqual(['study']);
		// Q1 first, then the Q2 with a due date, then the Q2 without one.
		// "Finish chapter 3" is missing because the day above already plans it,
		// and "Set up the reading list" because it is done.
		expect(groups[0].cards.map((t) => t.text)).toEqual([
			'Read the appendix',
			'Write up the notes',
			'Order the textbook'
		]);
	});

	it('names no workspace when the vault has none', () => {
		expect(gather(index, DAY, []).fromWorkspaces).toEqual([]);
	});

	it('is empty and harmless for a day with no note at all', () => {
		const facts = gather(index, '2030-01-01', WORKSPACES);
		expect(facts.scheduled).toEqual([]);
		expect(facts.unfinished).toEqual([]);
	});
});

describe('render', () => {
	it('lists what is scheduled, overdue, blocked and left over', () => {
		const text = render(gather(index, DAY, WORKSPACES), 'A busy morning.');
		expect(text).toContain('A busy morning.');
		expect(text).toContain('**Scheduled**');
		expect(text).toContain('Morning stretch');
		expect(text).toContain('**Not finished yesterday**');
		expect(text).toContain('Something left over');
	});

	it('says so plainly when there is nothing at all', () => {
		// No workspaces either: a vault with boards always has something to
		// offer, and the empty body is what a bare vault gets.
		expect(render(gather(index, '2030-01-01', []))).toContain('A clear day.');
	});

	it('lists the workspace cards after Blocked and before yesterday', () => {
		const text = render(gather(index, DAY, WORKSPACES));
		expect(text).toContain('**From your workspaces**\n- Study: Read the appendix — [[Study/Algorithms]]');
		expect(text.indexOf('**From your workspaces**')).toBeLessThan(text.indexOf('**Not finished yesterday**'));
	});

	it('leaves the section out when every board is already on the day', () => {
		expect(render(gather(index, DAY, []))).not.toContain('From your workspaces');
	});

	it('never writes the markers itself', () => {
		expect(render(gather(index, DAY, WORKSPACES), 'x')).not.toContain('hub:briefing');
	});

	it('works with no sentence from the model', () => {
		expect(render(gather(index, DAY, WORKSPACES))).toContain('**Scheduled**');
	});
});

describe('propose, and what it writes', () => {
	it('is one edit, in the marker region of today\'s note', async () => {
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'A busy morning.', STAMP);
		expect(p.edits).toHaveLength(1);
		expect(p.edits[0].kind).toBe('replace-region');
		expect(p.edits[0].path).toBe(TODAY_PATH);
	});

	it('applies without a click, because the briefing is G1\'s one exception', async () => {
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'A busy morning.', STAMP);
		const result = await apply(vault, p, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		expect(result.written).toEqual([TODAY_PATH]);
	});

	it('leaves every byte outside the markers exactly as the user wrote it', async () => {
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'A busy morning.', STAMP);
		await apply(vault, p, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });

		const after = (await vault.read(TODAY_PATH)).content;
		const OPEN = '<!-- hub:briefing start -->';
		const CLOSE = '<!-- hub:briefing end -->';
		expect(after.slice(0, after.indexOf(OPEN))).toBe(USER_NOTE.slice(0, USER_NOTE.indexOf(OPEN)));
		expect(after.slice(after.indexOf(CLOSE))).toBe(USER_NOTE.slice(USER_NOTE.indexOf(CLOSE)));
		// Including the things that are easy to lose.
		expect(after).toContain('Something personal I wrote at 2am. Do not touch.');
		expect(after).toContain('\t- what am I avoiding, and why   ');
		expect(after.endsWith('```\n   \n')).toBe(true);
	});

	it('replaces the stale text rather than stacking a second briefing', async () => {
		const p1 = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'First.', STAMP);
		await apply(vault, p1, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		const p2 = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'Second.', STAMP);
		await apply(vault, p2, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });

		const after = (await vault.read(TODAY_PATH)).content;
		expect(after).not.toContain('stale text from yesterday');
		expect(after).not.toContain('First.');
		expect(after).toContain('Second.');
		expect(after.match(/hub:briefing start/g)).toHaveLength(1);
	});

	it('proposes adding the markers, rather than editing, when they are absent', async () => {
		await vault.write(TODAY_PATH, '# A plain day\n\nNo markers here.\n');
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'x', STAMP);
		expect(p.edits[0].kind).toBe('append');
		// And that one waits for a human, because it changes the note's shape.
		const result = await apply(vault, p, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		expect(result.written).toEqual([]);
		expect(result.refusals[0].guardrail).toBe('G1');
	});

	it('writes the markers once accepted, and nothing else', async () => {
		const before = '# A plain day\n\nNo markers here.\n';
		await vault.write(TODAY_PATH, before);
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'x', STAMP);
		await apply(vault, p, policy(), { accepted: [p.edits[0].id], vaultPath: root, undoPath: undoRoot });
		const after = (await vault.read(TODAY_PATH)).content;
		expect(after.startsWith(before)).toBe(true);
		expect(after).toContain('<!-- hub:briefing start -->');
	});
});

describe('the briefing policy', () => {
	it('allows exactly one file: the day\'s own note', () => {
		expect(policy().path.allow).toEqual([TODAY_PATH]);
		expect(policy().blast.maxFiles).toBe(1);
		expect(policy().blast.writableDays).toEqual([DAY]);
	});

	it('refuses to touch yesterday, even though the note exists', async () => {
		const p = await propose(vault, YESTERDAY, gather(index, YESTERDAY, WORKSPACES), 'x', STAMP);
		// The proposal is built for yesterday but judged by today's policy, as
		// it would be if a date calculation had gone wrong.
		const result = await validate(vault, p, policy(DAY));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals.some((r) => r.guardrail === 'G4' || r.guardrail === 'G5')).toBe(true);
	});

	it('refuses any other note, whatever the proposal claims', async () => {
		const p = await propose(vault, DAY, gather(index, DAY, WORKSPACES), 'x', STAMP);
		const tampered = {
			...p,
			edits: [{ ...p.edits[0], path: 'Notes/Somewhere else.md' } as (typeof p.edits)[number]]
		};
		const result = await validate(vault, tampered, policy(DAY));
		expect(result.ok).toBe(false);
	});
});

describe('openerPrompt', () => {
	it('asks for prose and says the lists are already written', () => {
		const prompt = openerPrompt(gather(index, DAY, WORKSPACES));
		expect(prompt).toContain('one or two sentences');
		expect(prompt).toContain('already written');
	});
});

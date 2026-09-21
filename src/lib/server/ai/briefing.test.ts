import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NoteIndex } from '../index/index';
import { Vault } from '../vault/index';
import { apply, policyFor, validate, type Policy } from './proposal';
import { gather, openerPrompt, propose, render } from './briefing';
import type { RunStamp } from '$lib/shared/ai';

const DAY = '2026-09-21';
const YESTERDAY = '2026-09-20';
const TODAY_PATH = 'Journal/2026/09/21.md';
const YESTERDAY_PATH = 'Journal/2026/09/20.md';

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
		const facts = gather(index, DAY);
		expect(facts.scheduled.map((t) => t.startMin)).toEqual([570, 640]);
	});

	it('finds what yesterday left unfinished, and not what it finished', () => {
		const texts = gather(index, DAY).unfinished.map((t) => t.text);
		expect(texts.some((t) => t.includes('Something left over'))).toBe(true);
		expect(texts.some((t) => t.includes('Something finished'))).toBe(false);
	});

	it('does not count a fenced checklist line as a task', () => {
		expect(gather(index, DAY).scheduled.every((t) => !t.fenced)).toBe(true);
	});

	it('is empty and harmless for a day with no note at all', () => {
		const facts = gather(index, '2030-01-01');
		expect(facts.scheduled).toEqual([]);
		expect(facts.unfinished).toEqual([]);
	});
});

describe('render', () => {
	it('lists what is scheduled, overdue, blocked and left over', () => {
		const text = render(gather(index, DAY), 'A busy morning.');
		expect(text).toContain('A busy morning.');
		expect(text).toContain('**Scheduled**');
		expect(text).toContain('Morning stretch');
		expect(text).toContain('**Not finished yesterday**');
		expect(text).toContain('Something left over');
	});

	it('says so plainly when there is nothing at all', () => {
		expect(render(gather(index, '2030-01-01'))).toContain('A clear day.');
	});

	it('never writes the markers itself', () => {
		expect(render(gather(index, DAY), 'x')).not.toContain('hub:briefing');
	});

	it('works with no sentence from the model', () => {
		expect(render(gather(index, DAY))).toContain('**Scheduled**');
	});
});

describe('propose, and what it writes', () => {
	it('is one edit, in the marker region of today\'s note', async () => {
		const p = await propose(vault, DAY, gather(index, DAY), 'A busy morning.', STAMP);
		expect(p.edits).toHaveLength(1);
		expect(p.edits[0].kind).toBe('replace-region');
		expect(p.edits[0].path).toBe(TODAY_PATH);
	});

	it('applies without a click, because the briefing is G1\'s one exception', async () => {
		const p = await propose(vault, DAY, gather(index, DAY), 'A busy morning.', STAMP);
		const result = await apply(vault, p, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		expect(result.written).toEqual([TODAY_PATH]);
	});

	it('leaves every byte outside the markers exactly as the user wrote it', async () => {
		const p = await propose(vault, DAY, gather(index, DAY), 'A busy morning.', STAMP);
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
		const p1 = await propose(vault, DAY, gather(index, DAY), 'First.', STAMP);
		await apply(vault, p1, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		const p2 = await propose(vault, DAY, gather(index, DAY), 'Second.', STAMP);
		await apply(vault, p2, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });

		const after = (await vault.read(TODAY_PATH)).content;
		expect(after).not.toContain('stale text from yesterday');
		expect(after).not.toContain('First.');
		expect(after).toContain('Second.');
		expect(after.match(/hub:briefing start/g)).toHaveLength(1);
	});

	it('proposes adding the markers, rather than editing, when they are absent', async () => {
		await vault.write(TODAY_PATH, '# A plain day\n\nNo markers here.\n');
		const p = await propose(vault, DAY, gather(index, DAY), 'x', STAMP);
		expect(p.edits[0].kind).toBe('append');
		// And that one waits for a human, because it changes the note's shape.
		const result = await apply(vault, p, policy(), { accepted: [], vaultPath: root, undoPath: undoRoot });
		expect(result.written).toEqual([]);
		expect(result.refusals[0].guardrail).toBe('G1');
	});

	it('writes the markers once accepted, and nothing else', async () => {
		const before = '# A plain day\n\nNo markers here.\n';
		await vault.write(TODAY_PATH, before);
		const p = await propose(vault, DAY, gather(index, DAY), 'x', STAMP);
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
		const p = await propose(vault, YESTERDAY, gather(index, YESTERDAY), 'x', STAMP);
		// The proposal is built for yesterday but judged by today's policy, as
		// it would be if a date calculation had gone wrong.
		const result = await validate(vault, p, policy(DAY));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.refusals.some((r) => r.guardrail === 'G4' || r.guardrail === 'G5')).toBe(true);
	});

	it('refuses any other note, whatever the proposal claims', async () => {
		const p = await propose(vault, DAY, gather(index, DAY), 'x', STAMP);
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
		const prompt = openerPrompt(gather(index, DAY));
		expect(prompt).toContain('one or two sentences');
		expect(prompt).toContain('already written');
	});
});

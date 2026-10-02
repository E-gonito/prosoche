import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { addGoal, addMilestone, findGoal, setFocus, goalLink, goalOf, goalRefs, goalTarget, parseGoals, withNewGoal, withNewMilestone } from './goals';

const NOTE = [
	'---',
	'weekly_hours: 6',
	'---',
	'## Pass AWS Solutions Architect',
	'target:: 2026-12-15',
	'- [x] Finish the networking module 📅 2026-10-05',
	'- [ ] Two practice exams 📅 2026-11-20',
	'',
	'## Read three papers a month',
	'- [ ] Paper one',
	'- [x] Paper two'
].join('\n');

describe('parseGoals', () => {
	it('reads the weekly hours target from the frontmatter', () => {
		expect(parseGoals(NOTE).weeklyHours).toBe(6);
	});

	it('reads the focus from the frontmatter, and none when it is blank or missing', () => {
		expect(parseGoals('---\nfocus: Read three papers a month\n---\n## Read three papers a month\n').focus).toBe('Read three papers a month');
		expect(parseGoals('---\nfocus:\n---\n## A goal\n').focus).toBeNull();
		expect(parseGoals(NOTE).focus).toBeNull();
	});

	it('has no weekly target when the note names none', () => {
		expect(parseGoals('## A goal\n- [ ] Milestone\n').weeklyHours).toBeNull();
	});

	it('finds one goal per heading, in file order', () => {
		const goals = parseGoals(NOTE);
		expect(goals.goals.map((g) => g.title)).toEqual(['Pass AWS Solutions Architect', 'Read three papers a month']);
	});

	it('reads a goal’s target date', () => {
		const [first, second] = parseGoals(NOTE).goals;
		expect(first.target).toBe('2026-12-15');
		expect(second.target).toBeNull();
	});

	it('reads milestones as tasks, with the vault’s own due-date field', () => {
		const [first] = parseGoals(NOTE, 'Study/Goals.md').goals;
		expect(first.milestones).toHaveLength(2);
		expect(first.milestones[0]).toMatchObject({
			path: 'Study/Goals.md',
			status: 'done',
			text: 'Finish the networking module',
			due: '2026-10-05'
		});
		expect(first.milestones[1]).toMatchObject({ status: 'todo', text: 'Two practice exams', due: '2026-11-20' });
	});

	it('stops a goal’s milestones at the next heading, not at the end of the file', () => {
		const goals = parseGoals(NOTE);
		expect(goals.goals[1].milestones.map((m) => m.text)).toEqual(['Paper one', 'Paper two']);
	});

	it('stamps every milestone with the absolute line it sits on', () => {
		const goals = parseGoals(NOTE);
		expect(goals.goals[0].milestones.map((m) => m.line)).toEqual([5, 6]);
	});

	it('is empty for a note with no goals yet', () => {
		expect(parseGoals('')).toEqual({ weeklyHours: null, focus: null, goals: [] });
	});

	it('ends a goal at a deeper heading too, matching where appendUnderHeading would insert', () => {
		const note = '## Goal\n- [ ] One\n### Notes\nSome prose\n## Next goal\n- [ ] Two';
		const goals = parseGoals(note);
		expect(goals.goals[0].milestones.map((m) => m.text)).toEqual(['One']);
		expect(goals.goals[1].milestones.map((m) => m.text)).toEqual(['Two']);
	});

	it('does not take a heading-shaped line in a code fence for a goal, as appendUnderHeading does not', () => {
		const note = '## Goal\n```sh\n## not a goal\n```\n- [ ] One\n';
		expect(parseGoals(note).goals.map((g) => g.title)).toEqual(['Goal']);
		const added = withNewMilestone(note, 'Goal', 'Two', null);
		expect(parseGoals(added.content).goals[0].milestones.map((m) => m.text)).toEqual(['One', 'Two']);
	});
});

describe('goalRefs', () => {
	it('names each goal with a slug and the link that points at it', () => {
		expect(goalRefs(parseGoals(NOTE))).toEqual([
			{ name: 'Pass AWS Solutions Architect', slug: 'pass-aws-solutions-architect', link: '[[Goals#Pass AWS Solutions Architect]]' },
			{ name: 'Read three papers a month', slug: 'read-three-papers-a-month', link: '[[Goals#Read three papers a month]]' }
		]);
	});

	it('keeps slugs unique when two names reduce to the same one', () => {
		expect(goalRefs(parseGoals('## C++\n## C#\n## !!!\n')).map((g) => g.slug)).toEqual(['c', 'c-2', 'goal']);
	});
});

describe('goalOf', () => {
	it.each([
		['Goals#Computer Systems', 'Computer Systems'],
		['goals#Computer Systems', 'Computer Systems'],
		['Study/CS/Goals#Computer Systems', 'Computer Systems'],
		['Goals.md#Computer Systems|CS', 'Computer Systems'],
		['Goals#C++ ', 'C++'],
		['Algorithms', null],
		['Goals', null],
		['My Goals#X', null],
		['Old Goals/Notes#X', null],
		[null, null]
	])('reads %j as %j', (target, goal) => {
		expect(goalOf(target)).toBe(goal);
	});

	it('reads back what goalLink writes', () => {
		expect(goalLink('Tagalog verbs')).toBe('[[Goals#Tagalog verbs]]');
		expect(goalOf(goalTarget('Tagalog verbs'))).toBe('Tagalog verbs');
	});
});

describe('findGoal', () => {
	const goals = goalRefs(parseGoals(NOTE));

	it('matches a written goal by slug, ignoring case and punctuation', () => {
		expect(findGoal(goals, 'read three papers a month')?.name).toBe('Read three papers a month');
		expect(findGoal(goals, 'Nothing like it')).toBeNull();
		expect(findGoal(goals, null)).toBeNull();
	});
});

describe('withNewGoal', () => {
	it('appends a heading and a target line to an existing note', () => {
		expect(withNewGoal('## Existing\n- [ ] Thing\n', 'New goal', '2026-12-01')).toBe(
			'## Existing\n- [ ] Thing\n\n## New goal\ntarget:: 2026-12-01\n'
		);
	});

	it('appends a heading with no target line when none is given', () => {
		expect(withNewGoal('## Existing\n', 'New goal', null)).toBe('## Existing\n\n## New goal\n');
	});

	it('starts a note that has nothing in it yet', () => {
		expect(withNewGoal('', 'First goal', null)).toBe('## First goal\n');
	});

	it('keeps the frontmatter when a note has one but no goals yet', () => {
		expect(withNewGoal('---\nweekly_hours: 6\n---\n', 'First goal', null)).toBe(
			'---\nweekly_hours: 6\n---\n\n## First goal\n'
		);
	});
});

describe('withNewMilestone', () => {
	it('appends a milestone under its goal, due-dated like any other task', () => {
		const note = '## Goal\ntarget:: 2026-12-01\n- [ ] One 📅 2026-10-01\n';
		const { content, line } = withNewMilestone(note, 'Goal', 'Two', '2026-11-01');
		expect(content).toBe('## Goal\ntarget:: 2026-12-01\n- [ ] One 📅 2026-10-01\n- [ ] Two 📅 2026-11-01\n');
		expect(line).toBe(3);
	});

	it('writes a milestone with no due date at all', () => {
		const { content } = withNewMilestone('## Goal\n', 'Goal', 'Undated', null);
		expect(content).toBe('## Goal\n- [ ] Undated\n');
	});

	it('lands under the right goal when the note holds several', () => {
		const note = '## A\n- [ ] a1\n\n## B\n- [ ] b1\n';
		const { content } = withNewMilestone(note, 'A', 'a2', null);
		expect(content.split('\n')).toEqual(['## A', '- [ ] a1', '- [ ] a2', '', '## B', '- [ ] b1', '']);
	});
});

describe('reading and writing the vault', () => {
	let root: string;
	let vault: Vault;
	const PATH = 'Study/Goals.md';

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-goals-'));
		vault = new Vault(root);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('creates the note the first time a goal is added', async () => {
		const result = await addGoal(vault, PATH, 'First goal', '2026-12-01');
		expect(result).toEqual({ ok: true });
		expect((await vault.read(PATH)).content).toBe('## First goal\ntarget:: 2026-12-01\n');
	});

	it('appends a second goal after the first, leaving it untouched', async () => {
		await vault.write(PATH, '## First\ntarget:: 2026-12-01\n- [ ] a\n');
		await addGoal(vault, PATH, 'Second', null);
		expect((await vault.read(PATH)).content).toBe('## First\ntarget:: 2026-12-01\n- [ ] a\n\n## Second\n');
	});

	it('refuses to add a milestone to a note that does not exist', async () => {
		expect(await addMilestone(vault, PATH, 'First', 'a milestone', null)).toEqual({ ok: false, reason: 'no-note' });
	});

	it('appends a milestone and returns it as a ready-to-tick task', async () => {
		await vault.write(PATH, '## First\n- [ ] a\n');
		const result = await addMilestone(vault, PATH, 'First', 'b', '2026-11-01');
		expect(result).toMatchObject({ ok: true, task: { path: PATH, text: 'b', due: '2026-11-01', status: 'todo' } });
		expect((await vault.read(PATH)).content).toBe('## First\n- [ ] a\n- [ ] b 📅 2026-11-01\n');
	});

	it('sets the focus as one frontmatter line, spelt as the heading is, leaving the goals as they were', async () => {
		await vault.write(PATH, NOTE);
		expect(await setFocus(vault, PATH, 'read three papers a month')).toEqual({ ok: true });
		const after = (await vault.read(PATH)).content;
		expect(after).toBe(NOTE.replace('weekly_hours: 6\n', 'weekly_hours: 6\nfocus: Read three papers a month\n'));

		expect(await setFocus(vault, PATH, 'Pass AWS Solutions Architect')).toEqual({ ok: true });
		expect((await vault.read(PATH)).content).toBe(NOTE.replace('weekly_hours: 6\n', 'weekly_hours: 6\nfocus: Pass AWS Solutions Architect\n'));
	});

	it('refuses a focus on a goal the note does not have', async () => {
		await vault.write(PATH, NOTE);
		expect(await setFocus(vault, PATH, 'Learn Rust')).toEqual({ ok: false, reason: 'no-goal' });
		expect((await vault.read(PATH)).content).toBe(NOTE);
		expect(await setFocus(vault, 'Study/None/Goals.md', 'Learn Rust')).toEqual({ ok: false, reason: 'no-goal' });
	});
});

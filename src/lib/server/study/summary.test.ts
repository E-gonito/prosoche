import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { NoteIndex } from '../index/index';
import { subjectsOf } from './subjects';
import { dueEverywhere, filesByGoal, progressByGoal, studySummary, subjectCard } from './summary';
import type { Workspace } from '../workspaces';

const TODAY = '2026-09-29'; // a Tuesday; the week starts on the 28th

const workspace = (slug: string, folders: string[], template?: string): Workspace => ({
	slug,
	name: slug.toUpperCase(),
	color: '#123456',
	tag: `ws/${slug}`,
	aliases: [],
	folders,
	template,
	path: `_hub/workspaces/${slug}.md`
});

const WORKSPACES = [workspace('cs', ['Study/CS', 'Computer Science'], 'study'), workspace('fil', ['Study/Filipino'], 'study'), workspace('work', ['Work'])];

describe('a subject’s summary', () => {
	let root: string;
	let vault: Vault;
	let index: NoteIndex;
	const [CS, FIL] = subjectsOf(WORKSPACES);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-summary-'));
		vault = new Vault(root);
		index = new NoteIndex(':memory:');
		await vault.write('Study/CS/Goals.md', '## Networks\n- [x] TCP\n- [ ] DNS 📅 2026-10-10\n\n## Operating Systems\n');
		await vault.write(
			'Study/CS/Sessions.md',
			[
				'## 2026-09',
				'- 2026-09-27 1h [[Goals#Networks]] last week',
				'- 2026-09-28 30m [[Goals#networks]] case differs',
				'- 2026-09-29 45m [[Goals#Operating Systems]]',
				'- 2026-09-29 20m [[Algorithms]] an old topic',
				'- 2026-09-29 10m [[Goals#Retired goal]]',
				''
			].join('\n')
		);
		await vault.write(
			'Study/CS/Reading List.md',
			[
				'## To read',
				'- [ ] Queued [[Goals#Networks]]',
				'## Reading',
				'- [ ] [TCP/IP Illustrated](https://x.io) [[Goals#Networks]] #book',
				'- [ ] Loose ends',
				'## Done',
				''
			].join('\n')
		);
		await vault.write('Study/CS/Flashcards/Nets.md', '---\ngoal: Networks\n---\n#flashcards\n\nA::1\n\nB::2\n<!--SR:!2027-01-01,4,250-->\n');
		await vault.write('Computer Science/Unfiled.md', '#flashcards\n\nC::3\n');
		await vault.write('Study/Filipino/Words.md', '#flashcards\n\nAso::Dog\n');
		await vault.write('Work/Cards.md', '#flashcards\n\nNot::study\n');
	});
	afterEach(async () => {
		index.close();
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('rolls milestones, hours, reading and cards up by goal', async () => {
		const { goals, unassigned } = progressByGoal(await studySummary(vault, index, CS, TODAY), TODAY);
		expect(goals.map((g) => [g.name, g.done, g.total, g.weekMinutes, g.reading.map((r) => r.title), g.due])).toEqual([
			['Networks', 1, 2, 30, ['TCP/IP Illustrated'], 1],
			['Operating Systems', 0, 0, 45, [], 0]
		]);
		expect(goals[0].next).toEqual({ text: 'DNS', due: '2026-10-10' });
		expect(unassigned).toMatchObject({ weekMinutes: 30, due: 1 });
		expect(unassigned.reading.map((r) => r.title)).toEqual(['Loose ends']);
	});

	it('does not report Goals.md’s target:: line as a card Obsidian cannot see', async () => {
		await vault.write('Study/CS/Goals.md', '## Networks\ntarget:: 2026-12-01\n');
		await vault.write('Study/CS/Loose.md', 'Untagged::card\n');
		const summary = await studySummary(vault, index, CS, TODAY);
		expect(summary.cards.invisible.map((n) => n.path)).toEqual(['Study/CS/Loose.md']);
	});

	it('narrows the queue to one goal, by slug or by name', async () => {
		const bySlug = await studySummary(vault, index, CS, TODAY, 'networks');
		expect(bySlug.cards.cards.map((c) => c.question)).toEqual(['A']);
		const byName = await studySummary(vault, index, CS, TODAY, 'Operating Systems');
		expect(byName.cards.cards).toEqual([]);
		expect(byName.cards.files).toHaveLength(2);
	});

	it('groups card files by goal, in Goals.md order, with the rest last', async () => {
		await vault.write('Study/CS/Flashcards/Gone.md', '---\ngoal: Retired goal\n---\n#flashcards\n\nD::4\n');
		const groups = filesByGoal(await studySummary(vault, index, CS, TODAY));
		expect(groups.map((g) => [g.goal?.name ?? null, g.files.map((f) => f.path), g.due])).toEqual([
			['Networks', ['Study/CS/Flashcards/Nets.md'], 1],
			[null, ['Computer Science/Unfiled.md', 'Study/CS/Flashcards/Gone.md'], 2]
		]);
	});

	it('keeps subjects apart', async () => {
		const fil = await studySummary(vault, index, FIL, TODAY);
		expect(fil.goals.goals).toEqual([]);
		expect(fil.sessions).toEqual([]);
		expect(fil.cards.cards.map((c) => c.question)).toEqual(['Aso']);
		expect(subjectCard(fil, TODAY)).toMatchObject({ slug: 'fil', goals: [], weekMinutes: 0, due: 1 });
	});

	it('gives each subject an index card', async () => {
		expect(subjectCard(await studySummary(vault, index, CS, TODAY), TODAY)).toEqual({
			slug: 'cs',
			name: 'CS',
			color: '#123456',
			goals: [
				{ name: 'Networks', done: 1, total: 2 },
				{ name: 'Operating Systems', done: 0, total: 0 }
			],
			weekMinutes: 105,
			due: 2,
			streak: 3
		});
	});

	it('reviews everything due across subjects, and nothing when there are none', async () => {
		const all = await dueEverywhere(vault, index, subjectsOf(WORKSPACES), TODAY);
		expect(all.cards.map((c) => c.question).sort()).toEqual(['A', 'Aso', 'C']);
		expect((await dueEverywhere(vault, index, [], TODAY)).total).toBe(0);
	});
});

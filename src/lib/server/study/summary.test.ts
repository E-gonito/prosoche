import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { readSubject } from './subjects';
import { focusOn, progressByGoal, studySummary, subjectCard } from './summary';

const TODAY = '2026-09-29';

const subject = (slug: string, folders: string[], extra = '') =>
	readSubject(`_hub/subjects/${slug}.md`, `---\nname: ${slug.toUpperCase()}\ncolor: "#123456"\ntag: ws/${slug}\nfolders:\n${folders.map((f) => `  - ${f}\n`).join('')}${extra}---\n`);

const SUBJECTS = [subject('cs', ['Study/CS', 'Computer Science']), subject('fil', ['Study/Filipino'])];

describe('a subject’s summary', () => {
	let root: string;
	let vault: Vault;
	const [CS, FIL] = SUBJECTS;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-summary-'));
		vault = new Vault(root);
		await vault.write('Study/CS/Goals.md', '## Networks\n- [x] TCP\n- [ ] DNS 📅 2026-10-10\n\n## Operating Systems\n');
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
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('gives each goal its steps done out of total, and the next', async () => {
		const goals = progressByGoal(await studySummary(vault, CS));
		expect(goals.map((g) => [g.name, g.done, g.total, g.next])).toEqual([
			['Networks', 1, 2, { text: 'DNS', due: '2026-10-10' }],
			['Operating Systems', 0, 0, null]
		]);
	});

	it('focuses on the first goal with a step open, as steps to take', async () => {
		const focus = focusOn(await studySummary(vault, CS), TODAY)!;
		expect(focus).toMatchObject({ name: 'Networks', index: 0, chosen: false, done: 1, total: 2, daysLeft: null });
		expect(focus.steps.map((s) => [s.task.text, s.state, s.daysLeft])).toEqual([
			['TCP', 'done', null],
			['DNS', 'now', 11]
		]);
		// Reading before To read; Done and items for other goals are left out.
		expect(focus.resources.map((r) => [r.title, r.group])).toEqual([
			['TCP/IP Illustrated', 'Reading'],
			['Queued', 'To read']
		]);
	});

	it('skips a finished goal, and follows focus: when it names a goal that is there', async () => {
		await vault.write('Study/CS/Goals.md', '## Done already\n- [x] all of it\n\n## Networks\ntarget:: 2026-09-20\n- [-] dropped\n- [ ] DNS 📅 2026-09-27\n- [ ] BGP\n\n## Operating Systems\n');
		const picked = focusOn(await studySummary(vault, CS), TODAY)!;
		expect(picked).toMatchObject({ name: 'Networks', index: 1, chosen: false, total: 2, daysLeft: -9 });
		expect(picked.steps.map((s) => [s.task.text, s.state, s.daysLeft])).toEqual([
			['dropped', 'skipped', null],
			['DNS', 'now', -2],
			['BGP', 'later', null]
		]);

		await vault.write('Study/CS/Goals.md', '---\nfocus: operating systems\n---\n## Networks\n- [ ] DNS\n\n## Operating Systems\n');
		expect(focusOn(await studySummary(vault, CS), TODAY)).toMatchObject({ name: 'Operating Systems', index: 1, chosen: true, steps: [] });

		await vault.write('Study/CS/Goals.md', '---\nfocus: Retired goal\n---\n## Networks\n- [x] DNS\n');
		expect(focusOn(await studySummary(vault, CS), TODAY)).toMatchObject({ name: 'Networks', chosen: false });
	});

	it('has no focus without goals', async () => {
		expect(focusOn(await studySummary(vault, FIL), TODAY)).toBeNull();
	});

	it('keeps subjects apart', async () => {
		const fil = await studySummary(vault, FIL);
		expect(fil.goals.goals).toEqual([]);
		expect(subjectCard(fil)).toMatchObject({ slug: 'fil', goals: [] });
	});

	it('gives each subject an index card', async () => {
		expect(subjectCard(await studySummary(vault, CS))).toEqual({
			slug: 'cs',
			name: 'CS',
			color: '#123456',
			goals: [
				{ name: 'Networks', done: 1, total: 2 },
				{ name: 'Operating Systems', done: 0, total: 0 }
			]
		});
	});

});

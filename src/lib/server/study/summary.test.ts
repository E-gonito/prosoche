import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../vault/index';
import { subjectsOf } from './subjects';
import { progressByGoal, studySummary, subjectCard } from './summary';
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
	const [CS, FIL] = subjectsOf(WORKSPACES);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-summary-'));
		vault = new Vault(root);
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
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	it('rolls milestones, hours and reading up by goal', async () => {
		const { goals, unassigned } = progressByGoal(await studySummary(vault, CS), TODAY);
		expect(goals.map((g) => [g.name, g.done, g.total, g.weekMinutes, g.reading.map((r) => r.title)])).toEqual([
			['Networks', 1, 2, 30, ['TCP/IP Illustrated']],
			['Operating Systems', 0, 0, 45, []]
		]);
		expect(goals[0].next).toEqual({ text: 'DNS', due: '2026-10-10' });
		expect(unassigned).toMatchObject({ weekMinutes: 30 });
		expect(unassigned.reading.map((r) => r.title)).toEqual(['Loose ends']);
	});




	it('keeps subjects apart', async () => {
		const fil = await studySummary(vault, FIL);
		expect(fil.goals.goals).toEqual([]);
		expect(fil.sessions).toEqual([]);
		expect(subjectCard(fil, TODAY)).toMatchObject({ slug: 'fil', goals: [], weekMinutes: 0 });
	});

	it('gives each subject an index card', async () => {
		expect(subjectCard(await studySummary(vault, CS), TODAY)).toEqual({
			slug: 'cs',
			name: 'CS',
			color: '#123456',
			goals: [
				{ name: 'Networks', done: 1, total: 2 },
				{ name: 'Operating Systems', done: 0, total: 0 }
			],
			weekMinutes: 105,
			streak: 3
		});
	});



});

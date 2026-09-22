import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { addToDay } from './day-plan';
import type { Workspace } from './workspaces';

const DAY = '2026-09-21';
const PATH = 'Journal/2026/09/21.md';
const CARD = 'Study/Algorithms.md';

const STUDY: Workspace = {
	slug: 'study',
	name: 'Study',
	color: '#7c3aed',
	tag: 'ws/study',
	aliases: [],
	folders: ['Study'],
	template: 'study',
	tabs: [],
	deck: '',
	kanbanColumns: [],
	path: '_hub/workspaces/study.md'
};

/** A day shaped like the author's: a plan, then a fenced backlog under it. */
const NOTE = [
	'# [[Journal 2026]]',
	'',
	'# Tasks',
	'- [x] 09:30 - 10:00 Morning stretch `Q1`',
	'- [ ] Twenty push ups',
	'## Backlog',
	'```',
	'- [ ] Driving licence `Q2`',
	'```',
	''
].join('\n');

const ALGORITHMS = '# Algorithms\n\n- [ ] Finish chapter 3 `Q2`\n';

describe('addToDay', () => {
	let root: string;
	let vault: Vault;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'hub-day-plan-'));
		vault = new Vault(root);
		await vault.write(CARD, ALGORITHMS);
	});
	afterEach(async () => {
		await vault.close();
		await rm(root, { recursive: true, force: true });
	});

	/** The card as the browser last saw it: note, line and that line's text. */
	const card = (line = 2, raw = '- [ ] Finish chapter 3 `Q2`') => ({ path: CARD, line, expectedRaw: raw });

	it('inserts before the next heading and after the last task', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(), { startMin: 600, endMin: 630 });

		expect(result).toMatchObject({ ok: true, path: PATH, line: 5 });
		expect(result.ok && result.raw).toBe(
			'- [ ] 10:00 - 10:30 Finish chapter 3 [[Study/Algorithms]] `Q2` #ws/study'
		);
		const after = (await vault.read(PATH)).content.split('\n');
		expect(after[4]).toBe('- [ ] Twenty push ups');
		expect(after[6]).toBe('## Backlog');
	});

	it('leaves every other byte of the day alone', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(), { startMin: 600, endMin: 630 });
		if (!result.ok) throw new Error('expected a block');

		const after = (await vault.read(PATH)).content.split('\n');
		expect(after).toHaveLength(NOTE.split('\n').length + 1);
		expect(after.toSpliced(result.line, 1)).toEqual(NOTE.split('\n'));
	});

	it('never touches the card', async () => {
		await vault.write(PATH, NOTE);
		await addToDay(vault, [STUDY], DAY, card(), { startMin: 600, endMin: 630 });
		expect((await vault.read(CARD)).content).toBe(ALGORITHMS);
	});

	it('creates the day from the template when it has none', async () => {
		await vault.write('Journal/Journal Template.md', '# Tasks\n- [ ] Morning stretch `Q1`\n## Backlog\n');
		const result = await addToDay(vault, [STUDY], DAY, card());

		expect(result.ok).toBe(true);
		expect((await vault.read(PATH)).content).toBe(
			'# Tasks\n- [ ] Morning stretch `Q1`\n- [ ] Finish chapter 3 [[Study/Algorithms]] `Q2` #ws/study\n## Backlog\n'
		);
	});

	it('writes no time prefix when the card is dropped without one', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card());
		expect(result.ok && result.raw).toBe('- [ ] Finish chapter 3 [[Study/Algorithms]] `Q2` #ws/study');
		expect(result.ok && result.task.startMin).toBe(null);
	});

	it('writes no tag when no workspace claims the card', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [], DAY, card());
		expect(result.ok && result.raw).toBe('- [ ] Finish chapter 3 [[Study/Algorithms]] `Q2`');
	});

	it('writes no quadrant when the card has none', async () => {
		await vault.write(CARD, '# Algorithms\n\n- [ ] Finish chapter 3\n');
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(2, '- [ ] Finish chapter 3'));
		expect(result.ok && result.raw).toBe('- [ ] Finish chapter 3 [[Study/Algorithms]] #ws/study');
	});

	it('does not repeat a tag the card already writes in its words', async () => {
		await vault.write(CARD, '# Algorithms\n\n- [ ] Finish #ws/study chapter 3 `Q2`\n');
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(2, '- [ ] Finish #ws/study chapter 3 `Q2`'));
		expect(result.ok && result.raw).toBe('- [ ] Finish #ws/study chapter 3 [[Study/Algorithms]] `Q2`');
	});

	it('returns the block as a task, ready to render', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(), { startMin: 600, endMin: 630 });
		expect(result.ok && result.task).toMatchObject({
			path: PATH,
			line: 5,
			status: 'todo',
			startMin: 600,
			endMin: 630,
			quadrant: 2,
			tags: ['ws/study']
		});
	});

	it('refuses when the card line changed underneath', async () => {
		await vault.write(PATH, NOTE);
		const result = await addToDay(vault, [STUDY], DAY, card(2, '- [ ] Finish chapter 2 `Q2`'));

		expect(result).toEqual({ ok: false, reason: 'line-changed', current: '- [ ] Finish chapter 3 `Q2`' });
		expect((await vault.read(PATH)).content).toBe(NOTE);
	});

	it('refuses when the card is not a task, and when its note is gone', async () => {
		await vault.write(PATH, NOTE);
		expect(await addToDay(vault, [STUDY], DAY, card(0, '# Algorithms'))).toEqual({
			ok: false,
			reason: 'not-a-task'
		});
		expect(await addToDay(vault, [STUDY], DAY, { path: 'Nowhere.md', line: 0, expectedRaw: '' })).toEqual({
			ok: false,
			reason: 'no-note'
		});
		expect((await vault.read(PATH)).content).toBe(NOTE);
	});

	it('creates no day note when the card refuses', async () => {
		await addToDay(vault, [STUDY], DAY, card(2, '- [ ] Something else'));
		expect((await vault.read(PATH)).exists).toBe(false);
	});

	it('appends the heading when the day has no Tasks section', async () => {
		await vault.write(PATH, '# [[Journal 2026]]\n\nNo plan today.\n');
		const result = await addToDay(vault, [STUDY], DAY, card());
		expect((await vault.read(PATH)).content).toBe(
			'# [[Journal 2026]]\n\nNo plan today.\n\n# Tasks\n- [ ] Finish chapter 3 [[Study/Algorithms]] `Q2` #ws/study\n'
		);
		expect(result.ok).toBe(true);
	});
});

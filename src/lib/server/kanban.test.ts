import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault, hashContent } from './vault/index';
import { boardPath, changeBoard, changeBoardFile, openCards, readBoard, readBoardFile } from './kanban';
import { DEFAULT_BOARD, emptyBoard } from './parse/kanban';
import type { Workspace } from './workspaces';

const WORK: Workspace = {
	slug: 'work',
	name: 'Work',
	color: '#2f6fed',
	tag: 'ws/work',
	aliases: [],
	folders: ['Work'],
	path: '_hub/workspaces/work.md'
};
const HOME: Workspace = { ...WORK, slug: 'home', name: 'Home', color: '#16a34a', folders: ['Home'], path: '_hub/workspaces/home.md' };

const BOARD = [
	'---',
	'',
	'kanban-plugin: board',
	'',
	'---',
	'',
	'## To do',
	'',
	'- [ ] Call the landlord @{2026-10-01} `Q1`',
	'- [x] Pay the deposit',
	'',
	'## Doing',
	'',
	'- [ ] Paint the hall',
	'',
	''
].join('\n');

let root: string;
let vault: Vault;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-kanban-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('readBoard', () => {
	it('reads a missing board as the default columns, without writing one', async () => {
		const board = await readBoard(vault, WORK);
		expect(board).toMatchObject({ workspace: 'work', path: 'Work/Board.md', exists: false, hash: hashContent('') });
		expect(board.columns.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
		expect((await vault.read('Work/Board.md')).exists).toBe(false);
	});

	it('reads the cards of a board that exists', async () => {
		await vault.write(boardPath(WORK), BOARD);
		const board = await readBoard(vault, WORK);
		expect(board.exists).toBe(true);
		expect(board.columns[0].cards).toEqual([
			{ line: 8, title: 'Call the landlord', due: '2026-10-01', priority: 1, labels: [], notes: '', done: false },
			{ line: 9, title: 'Pay the deposit', due: null, priority: null, labels: [], notes: '', done: true }
		]);
	});
});

describe('changeBoard', () => {
	it('creates the default board with the first change applied', async () => {
		const before = await readBoard(vault, WORK);
		const result = await changeBoard(vault, WORK, before.hash, { kind: 'add-card', column: 0, text: 'Ring the bank' }, '2026-09-29');
		expect(result.ok).toBe(true);
		const content = (await vault.read('Work/Board.md')).content;
		expect(content.startsWith('---\n\nkanban-plugin: board\n\n---\n\n## To do\n\n- [ ] Ring the bank\n')).toBe(true);
		expect(content.endsWith('%% kanban:settings\n```\n{"kanban-plugin":"board"}\n```\n%%')).toBe(true);
		if (result.ok) expect(result.board).toMatchObject({ exists: true, hash: hashContent(content) });
	});

	it('refuses a stale hash and returns the board as it is now', async () => {
		await vault.write(boardPath(WORK), BOARD);
		const seen = await readBoard(vault, WORK);
		await vault.write(boardPath(WORK), BOARD.replace('Paint the hall', 'Paint the stairs'));
		const result = await changeBoard(vault, WORK, seen.hash, { kind: 'toggle-card', line: 13, done: true });
		expect(result).toMatchObject({ ok: false, reason: 'conflict' });
		expect(result.board.columns[1].cards[0].title).toBe('Paint the stairs');
		expect((await vault.read('Work/Board.md')).content).toContain('- [ ] Paint the stairs');
	});

	it('refuses a board that appeared since a missing one was read', async () => {
		const seen = await readBoard(vault, WORK);
		await vault.write(boardPath(WORK), BOARD);
		const result = await changeBoard(vault, WORK, seen.hash, { kind: 'add-card', column: 0, text: 'x' });
		expect(result).toMatchObject({ ok: false, reason: 'conflict' });
		expect((await vault.read('Work/Board.md')).content).toBe(BOARD);
	});

	it('passes a refusal from the grammar through, writing nothing', async () => {
		await vault.write(boardPath(WORK), BOARD);
		const seen = await readBoard(vault, WORK);
		const result = await changeBoard(vault, WORK, seen.hash, { kind: 'delete-column', column: 0 });
		expect(result).toMatchObject({ ok: false, reason: 'not-empty' });
		expect((await vault.read('Work/Board.md')).content).toBe(BOARD);
	});

	it('moves a card and reports the board it wrote', async () => {
		await vault.write(boardPath(WORK), BOARD);
		const seen = await readBoard(vault, WORK);
		const result = await changeBoard(vault, WORK, seen.hash, { kind: 'move-card', line: 8, column: 1, index: 0 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.board.columns.map((c) => c.cards.map((card) => card.title))).toEqual([
			['Pay the deposit'],
			['Call the landlord', 'Paint the hall']
		]);
		expect(result.board.hash).toBe((await vault.read('Work/Board.md')).hash);
	});
});

describe('changeBoardFile', () => {
	const FALLBACK = emptyBoard(['To read', 'Done'], 'Done');

	it('reads a missing file at any path as its own fallback, and writes it with the first change', async () => {
		const seen = await readBoardFile(vault, 'Study/Reading List.md', FALLBACK);
		expect(seen).toMatchObject({ path: 'Study/Reading List.md', exists: false });
		expect(seen.board.columns.map((c) => c.title)).toEqual(['To read', 'Done']);

		const result = await changeBoardFile(vault, seen.path, seen.hash, { kind: 'add-card', column: 1, text: 'SICP fri', literal: true }, { fallback: FALLBACK });
		expect(result.ok).toBe(true);
		expect((await vault.read(seen.path)).content).toBe(FALLBACK.replace('**Complete**\n', '**Complete**\n- [ ] SICP fri\n'));
	});

	it('deletes a card, and refuses a stale hash', async () => {
		await vault.write('Work/Board.md', BOARD);
		const seen = await readBoardFile(vault, 'Work/Board.md');
		const deleted = await changeBoardFile(vault, seen.path, seen.hash, { kind: 'delete-card', line: 9 });
		expect(deleted.ok).toBe(true);
		expect((await vault.read('Work/Board.md')).content).toBe(BOARD.replace('- [x] Pay the deposit\n', ''));
		const stale = await changeBoardFile(vault, seen.path, seen.hash, { kind: 'delete-card', line: 8 });
		expect(stale).toMatchObject({ ok: false, reason: 'conflict' });
	});
});

describe('openCards', () => {
	it('lists every unticked card from every board, with its workspace, column and hash', async () => {
		await vault.write(boardPath(WORK), BOARD);
		await vault.write(boardPath(HOME), DEFAULT_BOARD.replace('## Doing\n\n', '## Doing\n\n- [ ] Fix the tap @{2026-09-20}\n'));
		const cards = await openCards(vault, [WORK, HOME]);
		expect(cards.map((c) => [c.workspace.slug, c.column, c.title, c.due])).toEqual([
			['work', 'To do', 'Call the landlord', '2026-10-01'],
			['work', 'Doing', 'Paint the hall', null],
			['home', 'Doing', 'Fix the tap', '2026-09-20']
		]);
		expect(cards[0]).toMatchObject({ path: 'Work/Board.md', hash: (await vault.read('Work/Board.md')).hash });
	});

	it('finds nothing for a workspace with no board', async () => {
		expect(await openCards(vault, [WORK])).toEqual([]);
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { createCard } from './cards';
import type { Workspace } from './workspaces';

function workspace(fields: Partial<Workspace> = {}): Workspace {
	return {
		slug: 'work',
		name: 'Work',
		color: '#2f6fed',
		tag: 'ws/work',
		aliases: [],
		folders: ['Work'],
		template: 'project',
		tabs: [],
		deck: 'Work/Tasks.md',
		kanbanColumns: [],
		path: '_hub/workspaces/work.md',
		...fields
	};
}

const DECK = ['# Work tasks', '', '- [ ] Draft the plan `Q2`', '- [x] Renew the certificate `Q4`', ''].join('\n');

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-cards-'));
	vault = new Vault(root);
	await vault.write('Work/Tasks.md', DECK);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

const read = () => vault.read('Work/Tasks.md').then((n) => n.content);

describe('createCard', () => {
	it('appends one line and leaves every other byte alone', async () => {
		const before = await read();
		const result = await createCard(vault, workspace(), { text: 'Book the room', quadrant: 2 });
		expect(result.ok).toBe(true);

		const after = await read();
		expect(after.startsWith(before)).toBe(true);
		expect(after.slice(before.length)).toBe('- [ ] Book the room `Q2` #ws/work\n');
	});

	it('returns the card it wrote, at the line it wrote it to', async () => {
		const result = await createCard(vault, workspace(), { text: 'Book the room', quadrant: 2 });
		if (!result.ok) throw new Error(result.reason);
		expect(result.task).toMatchObject({
			path: 'Work/Tasks.md',
			line: 4,
			status: 'todo',
			text: 'Book the room',
			quadrant: 2,
			tags: ['ws/work']
		});
		expect((await read()).split('\n')[result.task.line]).toBe(result.task.raw);
	});

	it('writes no quadrant when none was chosen', async () => {
		await createCard(vault, workspace(), { text: 'Someday' });
		expect((await read()).split('\n').at(-2)).toBe('- [ ] Someday #ws/work');
	});

	it('uses the workspace tag as written, not the slug', async () => {
		await createCard(vault, workspace({ slug: 'side-projects', tag: 'ws/side' }), { text: 'Ship it' });
		expect(await read()).toContain('- [ ] Ship it #ws/side');
	});

	it('tags the card for a column no status can express', async () => {
		const ws = workspace({ kanbanColumns: ['To do', 'Review', 'Done'] });
		await createCard(vault, ws, { text: 'Read the draft', quadrant: 3, column: 'review' });
		expect(await read()).toContain('- [ ] Read the draft `Q3` #ws/work #col/review');
	});

	it('writes the marker of a status column, so the card appears where it was made', async () => {
		const ws = workspace({ kanbanColumns: ['To do', 'In progress', 'Done'] });
		const result = await createCard(vault, ws, { text: 'Already going', column: 'in-progress' });
		expect(await read()).toContain('- [/] Already going #ws/work');
		expect(result.ok && result.task.status).toBe('in-progress');
	});

	it('ignores a column the workspace does not have', async () => {
		await createCard(vault, workspace(), { text: 'Nowhere', column: 'made-up' });
		expect(await read()).toContain('- [ ] Nowhere #ws/work');
	});

	it('creates the deck with a heading when it does not exist yet', async () => {
		const result = await createCard(vault, workspace({ deck: 'Work/New Deck.md' }), { text: 'First card' });
		expect(result.ok).toBe(true);
		expect((await vault.read('Work/New Deck.md')).content).toBe('# Work\n\n- [ ] First card #ws/work\n');
	});

	it('keeps a deck that ends without a newline ending without one', async () => {
		await vault.write('Work/Tasks.md', '# Work\n- [ ] One `Q1`');
		await createCard(vault, workspace(), { text: 'Two' });
		expect(await read()).toBe('# Work\n- [ ] One `Q1`\n- [ ] Two #ws/work');
	});

	it('refuses empty text rather than writing a blank task', async () => {
		const before = await read();
		expect(await createCard(vault, workspace(), { text: '   \n\t ' })).toEqual({ ok: false, reason: 'no-text' });
		expect(await read()).toBe(before);
	});

	it('refuses when the workspace names no deck', async () => {
		expect(await createCard(vault, workspace({ deck: '' }), { text: 'Nowhere to go' })).toEqual({
			ok: false,
			reason: 'no-deck'
		});
	});

	it('makes one card out of pasted text, checkbox and newlines included', async () => {
		await createCard(vault, workspace(), { text: '- [ ] Call the\n  supplier back  ' });
		const lines = (await read()).split('\n');
		expect(lines.at(-2)).toBe('- [ ] Call the supplier back #ws/work');
		expect(lines.filter((l) => l.includes('supplier'))).toHaveLength(1);
	});

	it('rejects a quadrant outside 1..4 instead of writing a nonsense token', async () => {
		await createCard(vault, workspace(), { text: 'Out of range', quadrant: 9 });
		expect(await read()).toContain('- [ ] Out of range #ws/work');
	});

	it('appends after a previous card, so two in a row both survive', async () => {
		await createCard(vault, workspace(), { text: 'One' });
		await createCard(vault, workspace(), { text: 'Two' });
		const lines = (await read()).split('\n');
		expect(lines.slice(-3)).toEqual(['- [ ] One #ws/work', '- [ ] Two #ws/work', '']);
	});
});

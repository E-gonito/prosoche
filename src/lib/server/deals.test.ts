import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { addDeal, dealsPath, listDeals, setDealStage } from './deals';
import { DEFAULT_STAGES, type Workspace } from './workspaces';

function workspace(fields: Partial<Workspace> = {}): Workspace {
	return {
		slug: 'work',
		name: 'Work',
		color: '#2f6fed',
		tag: 'ws/work',
		aliases: [],
		folders: ['Work'],
		stages: DEFAULT_STAGES,
		path: '_hub/workspaces/work.md',
		...fields
	};
}

let root: string;
let vault: Vault;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-deals-'));
	vault = new Vault(root);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('addDeal', () => {
	it('creates Deals.md the first time and appends afterwards', async () => {
		const ws = workspace();
		const first = await addDeal(vault, ws, { text: 'Moorfields pilot', person: 'Jane Doe', stage: 'proposal', value: '12000' });
		if (!first.ok) throw new Error('expected the deal to be added');
		expect(first.deal.text).toBe('Moorfields pilot [[Jane Doe]]');
		expect(first.deal.stage).toBe('proposal');
		expect(first.deal.value).toBe(12000);

		const second = await addDeal(vault, ws, { text: 'Second deal' });
		expect(second.ok).toBe(true);

		const deals = await listDeals(vault, ws);
		expect(deals.map((d) => d.text)).toEqual(['Moorfields pilot [[Jane Doe]]', 'Second deal']);
		expect((await vault.read(dealsPath(ws))).content).toContain('- Moorfields pilot [[Jane Doe]]');
	});

	it('defaults the stage to the workspace pipeline’s first stage', async () => {
		const ws = workspace({ stages: ['new', 'won'] });
		const added = await addDeal(vault, ws, { text: 'No stage given' });
		if (!added.ok) throw new Error('expected the deal to be added');
		expect(added.deal.stage).toBe('new');
	});

	it('refuses a deal with no words', async () => {
		expect(await addDeal(vault, workspace(), { text: '   ' })).toEqual({ ok: false, reason: 'no-text' });
	});

	it('never touches an existing line, only appends', async () => {
		const ws = workspace();
		await vault.write(dealsPath(ws), '# Work deals\n\n- Existing deal stage:: won\n');
		await addDeal(vault, ws, { text: 'New deal' });
		const content = (await vault.read(dealsPath(ws))).content;
		expect(content).toContain('- Existing deal stage:: won\n- New deal');
	});
});

describe('setDealStage', () => {
	it('rewrites only the stage field of the named line', async () => {
		const ws = workspace();
		await vault.write(dealsPath(ws), '# Deals\n\n- Deal A stage:: lead\n- Deal B stage:: proposal\n');
		const raw = '- Deal A stage:: lead';
		const result = await setDealStage(vault, ws, 2, raw, 'negotiation');
		if (!result.ok) throw new Error('expected the stage to change');
		expect(result.deal.stage).toBe('negotiation');
		const content = (await vault.read(dealsPath(ws))).content;
		expect(content).toContain('- Deal A stage:: negotiation');
		expect(content).toContain('- Deal B stage:: proposal');
	});

	it('refuses when the line changed underneath', async () => {
		const ws = workspace();
		await vault.write(dealsPath(ws), '# Deals\n\n- Deal A stage:: lead\n');
		const result = await setDealStage(vault, ws, 2, '- Deal A stage:: something-else', 'won');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe('line-changed');
	});

	it('reports no-note rather than creating one', async () => {
		const result = await setDealStage(vault, workspace(), 0, '- x', 'won');
		expect(result).toEqual({ ok: false, reason: 'no-note' });
	});
});

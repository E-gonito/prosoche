import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { loadWorkspaces, type Workspace } from './workspaces';
import { createContact, listContacts, readContact, updateContact } from './crm';

let root: string;
let vault: Vault;
let shop: Workspace;
let secret: Workspace;

const MANG_TOMAS = [
	'---',
	'kind: supplier',
	'company: Mang Tomas Foods',
	'role: Sales',
	'email: orders@mangtomas.ph',
	'phone: +44 7700 900123',
	'links:',
	'  - https://mangtomas.ph',
	'---',
	'',
	'Pork and chicken supplier. Met at the [[Trade Fair]].',
	'',
	'## History',
	'- 2026-09-29 Asked for a wholesale price list',
	'- 2026-09-22 First call',
	''
].join('\n');

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'hub-crm-'));
	vault = new Vault(root);
	await vault.write('_hub/workspaces/shop.md', '---\nname: Shop\nfolders:\n  - Shop\n  - Elsewhere\n---\n');
	await vault.write('_hub/workspaces/secret.md', '---\nname: Secret\nfolders:\n  - Private/Secret\n---\n');
	[secret, shop] = await loadWorkspaces(vault);
	await vault.write('Shop/CRM/Mang Tomas Foods.md', MANG_TOMAS);
});
afterEach(async () => {
	await vault.close();
	await rm(root, { recursive: true, force: true });
});

describe('listContacts', () => {
	it('lists the home folder’s contacts, most recent interaction first, then the rest by name', async () => {
		await vault.write('Shop/CRM/Print Co.md', '---\nkind: supplier\n---\n\n## History\n- 2026-09-30 Quote\n');
		await vault.write('Shop/CRM/zed.md', '---\nkind: lead\n---\n');
		await vault.write('Shop/CRM/Ada.md', '---\nkind: stakeholder\n---\n');

		const list = await listContacts(vault, shop);
		expect(list.map((c) => c.name)).toEqual(['Print Co', 'Mang Tomas Foods', 'Ada', 'zed']);
		expect(list[1]).toEqual({
			name: 'Mang Tomas Foods',
			path: 'Shop/CRM/Mang Tomas Foods.md',
			kind: 'supplier',
			company: 'Mang Tomas Foods',
			role: 'Sales',
			lastInteraction: '2026-09-29',
			interactions: 2
		});
	});

	it('leaves out subfolders, other folders and people notes', async () => {
		await vault.write('Shop/CRM/Archive/Old.md', '---\nkind: lead\n---\n');
		await vault.write('Elsewhere/CRM/Other.md', '---\nkind: lead\n---\n');
		await vault.write('People/Ada Lovelace.md', '---\ntype: person\n---\n');
		expect((await listContacts(vault, shop)).map((c) => c.name)).toEqual(['Mang Tomas Foods']);
	});

	it('is empty for a workspace with no CRM folder, and for one under Private/', async () => {
		await vault.write('Private/Secret/CRM/Hidden.md', '---\nkind: lead\n---\n', undefined, { scope: 'private' });
		expect(await listContacts(vault, secret)).toEqual([]);
	});
});

describe('readContact', () => {
	it('reads details, notes and history newest first', async () => {
		await vault.write('Shop/CRM/Mang Tomas Foods.md', MANG_TOMAS.replace('- 2026-09-22 First call', '- 2026-09-22 First call\n- no date\n- 2026-09-25 Tasting'));
		const c = (await readContact(vault, shop, 'Mang Tomas Foods'))!;
		expect(c).toMatchObject({
			kind: 'supplier',
			links: ['https://mangtomas.ph'],
			notes: 'Pork and chicken supplier. Met at the [[Trade Fair]].',
			lastInteraction: '2026-09-29',
			interactions: 4
		});
		expect(c.history.map((h) => h.day)).toEqual(['2026-09-29', '2026-09-25', '2026-09-22', null]);
		expect(c.hash).toBe((await vault.read('Shop/CRM/Mang Tomas Foods.md')).hash);
	});

	it('finds a contact made in Obsidian with a name the form would refuse', async () => {
		await vault.write('Shop/CRM/Q&A #1.md', '---\nkind: lead\n---\n');
		expect((await readContact(vault, shop, 'Q&A #1'))?.name).toBe('Q&A #1');
	});

	it.each(['Nobody', '', '../../_hub/workspaces/shop', '.hidden'])('reads %j as missing', async (name) => {
		expect(await readContact(vault, shop, name)).toBeNull();
	});
});

describe('createContact', () => {
	it('writes a new note and returns it', async () => {
		const result = await createContact(vault, shop, '  Print  Co ', { kind: 'supplier', company: 'Print Co Ltd', notes: 'Menus.' });
		expect(result).toMatchObject({ ok: true, contact: { name: 'Print Co', kind: 'supplier', company: 'Print Co Ltd', interactions: 0 } });
		expect((await vault.read('Shop/CRM/Print Co.md')).content).toBe(
			'---\nkind: supplier\ncompany: Print Co Ltd\nrole:\nemail:\nphone:\nlinks:\n---\n\nMenus.\n\n## History\n'
		);
	});

	it('refuses a name clash, ignoring case, and leaves the existing note alone', async () => {
		expect(await createContact(vault, shop, 'mang tomas foods')).toEqual({ ok: false, reason: 'exists' });
		expect((await vault.read('Shop/CRM/Mang Tomas Foods.md')).content).toBe(MANG_TOMAS);
	});

	it.each(['', 'a/b', '../x', 'Sales: EMEA', '[[x]]'])('refuses the unsafe name %j', async (name) => {
		expect(await createContact(vault, shop, name)).toEqual({ ok: false, reason: 'bad-name' });
	});

	it('refuses a workspace whose home is private, writing nothing', async () => {
		expect(await createContact(vault, secret, 'Hidden')).toEqual({ ok: false, reason: 'private' });
		expect(await vault.list({ scope: 'private' })).toEqual([]);
	});
});

describe('updateContact', () => {
	const hashOf = async () => (await vault.read('Shop/CRM/Mang Tomas Foods.md')).hash;
	const content = async () => (await vault.read('Shop/CRM/Mang Tomas Foods.md')).content;

	it('sets and clears fields as span edits', async () => {
		const result = await updateContact(vault, shop, 'Mang Tomas Foods', await hashOf(), {
			fields: { role: 'Head of sales', email: '', links: ['https://a.example', 'https://b.example'] }
		});
		expect(result.ok).toBe(true);
		expect(await content()).toBe(
			MANG_TOMAS.replace('role: Sales', 'role: Head of sales')
				.replace('email: orders@mangtomas.ph', 'email:')
				.replace('  - https://mangtomas.ph', '  - https://a.example\n  - https://b.example')
		);
	});

	it('adds a history entry in date order, today by default', async () => {
		const first = await updateContact(vault, shop, 'Mang Tomas Foods', await hashOf(), { entry: { day: '2026-09-25', text: 'Tasting' } });
		expect(first.ok && first.contact.history.map((h) => h.text)).toEqual(['Asked for a wholesale price list', 'Tasting', 'First call']);
		expect(await content()).toBe(MANG_TOMAS.replace('- 2026-09-22', '- 2026-09-25 Tasting\n- 2026-09-22'));

		const second = await updateContact(vault, shop, 'Mang Tomas Foods', await hashOf(), { entry: { text: 'Order placed' } });
		expect(second.ok && second.contact.lastInteraction).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(await content()).toContain('Order placed');
	});

	it('refuses a stale hash and writes nothing', async () => {
		const stale = await hashOf();
		await vault.write('Shop/CRM/Mang Tomas Foods.md', MANG_TOMAS.replace('Sales', 'Buying'));
		expect(await updateContact(vault, shop, 'Mang Tomas Foods', stale, { fields: { kind: 'lead' } })).toEqual({ ok: false, reason: 'conflict' });
		expect(await content()).toBe(MANG_TOMAS.replace('Sales', 'Buying'));
	});

	it.each([
		[{ entry: { text: '   ' } }, 'no-text'],
		[{ entry: { day: '2026-02-30', text: 'x' } }, 'bad-day'],
		[{ fields: { kind: 'lead' }, entry: { text: '' } }, 'no-text']
	] as const)('refuses %j as %s, fields included', async (change, reason) => {
		expect(await updateContact(vault, shop, 'Mang Tomas Foods', await hashOf(), change)).toEqual({ ok: false, reason });
		expect(await content()).toBe(MANG_TOMAS);
	});

	it('refuses a contact that does not exist', async () => {
		expect(await updateContact(vault, shop, 'Nobody', 'x', { fields: { kind: 'lead' } })).toEqual({ ok: false, reason: 'missing' });
	});

	it('ignores keys that are not contact fields, and writes nothing when nothing changes', async () => {
		const hash = await hashOf();
		const change = { fields: { role: 'Sales', title: 'x' } } as unknown as Parameters<typeof updateContact>[4];
		const result = await updateContact(vault, shop, 'Mang Tomas Foods', hash, change);
		expect(result.ok && result.contact.hash).toBe(hash);
		expect(await content()).toBe(MANG_TOMAS);
	});
});

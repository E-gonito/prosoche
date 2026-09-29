import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { migrateGlossaries, planGlossaryMoves } from './glossary-migration';
import { loadWorkspaces, type Workspace } from './workspaces';

const ws = (slug: string, over: Partial<Workspace> = {}): Workspace => ({
	slug,
	name: slug,
	color: '#000',
	tag: `ws/${slug}`,
	aliases: [],
	folders: [],
	path: `_hub/workspaces/${slug}.md`,
	...over
});

describe('planGlossaryMoves', () => {
	const eye = ws('eye2gene', { folders: ['Work Projects/eye2gene'], meetings: true });
	const cs = ws('cs-study', { name: 'CS study', folders: ['Study/Computer Science', 'Computer Science'] });
	const paths = ['Work Projects/eye2gene/Glossary.md', 'Computer Science/Glossary.md', 'Study/Computer Science/TCP.md'];

	it('names each glossary after the folder that held it, and links only a home folder with meetings', () => {
		expect(planGlossaryMoves([eye, cs], paths)).toEqual([
			{ from: 'Work Projects/eye2gene/Glossary.md', name: 'eye2gene', to: 'Glossaries/eye2gene.md', link: [eye] },
			{ from: 'Computer Science/Glossary.md', name: 'Computer Science', to: 'Glossaries/Computer Science.md', link: [] }
		]);
	});

	it('moves a shared file once, and links neither a workspace that already names a glossary nor a second folder', () => {
		const a = ws('a', { folders: ['/Shared/'], meetings: true });
		const b = ws('b', { folders: ['Shared'], meetings: true, glossary: 'Elsewhere' });
		const c = ws('c', { folders: ['Mine', 'Shared'], meetings: true });
		expect(planGlossaryMoves([a, b, c], ['Shared/Glossary.md'])).toEqual([{ from: 'Shared/Glossary.md', name: 'Shared', to: 'Glossaries/Shared.md', link: [a] }]);
	});

	it('finds nothing once the old files are gone, and never moves out of Glossaries itself', () => {
		expect(planGlossaryMoves([eye, cs], ['Glossaries/eye2gene.md'])).toEqual([]);
		expect(planGlossaryMoves([ws('g', { folders: ['Glossaries'] })], ['Glossaries/Glossary.md'])).toEqual([]);
		expect(planGlossaryMoves([ws('n', { folders: [] })], ['Glossary.md'])).toEqual([]);
	});
});

describe('migrateGlossaries', () => {
	let dir: string;
	let vault: Vault;

	const EYE_DEF = '---\nname: eye2gene\ncolor: "#2f6fed"\ntag: ws/eye2gene\ntemplate: project\nmeetings: true\nfolders:\n  - "Work Projects/eye2gene"\ntabs:\n  - title: Board\n    widgets: [board]\n---\n';
	const CS_DEF = '---\nname: CS study\ncolor: "#7c3aed"\ntemplate: study\nfolders:\n  - "Study/Computer Science"\n  - "Computer Science"\n---\n';
	const EYE = '# Glossary\n\nMy own preamble.\n\n## DVC\n- status:: looked-up\n\nTracks data.\n\n## MLflow\n- status:: to-look-up\n';
	const CS = '# Glossary\r\n\r\n## TCP\r\n- status:: looked-up\r\n\r\nTransport.\r\n';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-migration-'));
		vault = new Vault(dir);
		await vault.write('_hub/workspaces/eye2gene.md', EYE_DEF);
		await vault.write('_hub/workspaces/cs-study.md', CS_DEF);
		await vault.write('Work Projects/eye2gene/Glossary.md', EYE);
		await vault.write('Computer Science/Glossary.md', CS);
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('moves each glossary byte for byte, removes the old file, and links the workspace with meetings', async () => {
		const report = await migrateGlossaries(vault, await loadWorkspaces(vault));
		expect(report).toEqual({
			moved: [
				{ from: 'Computer Science/Glossary.md', to: 'Glossaries/Computer Science.md' },
				{ from: 'Work Projects/eye2gene/Glossary.md', to: 'Glossaries/eye2gene.md' }
			],
			linked: [{ workspace: 'eye2gene', glossary: 'eye2gene' }],
			left: []
		});
		expect((await vault.read('Glossaries/eye2gene.md')).content).toBe(EYE);
		expect((await vault.read('Glossaries/Computer Science.md')).content).toBe(CS);
		expect((await vault.read('Work Projects/eye2gene/Glossary.md')).exists).toBe(false);
		expect((await vault.read('Computer Science/Glossary.md')).exists).toBe(false);
		expect((await vault.read('_hub/workspaces/eye2gene.md')).content).toBe(EYE_DEF.replace('    widgets: [board]\n---', '    widgets: [board]\nglossary: eye2gene\n---'));
		expect((await vault.read('_hub/workspaces/cs-study.md')).content).toBe(CS_DEF);
		expect((await loadWorkspaces(vault)).find((w) => w.slug === 'eye2gene')?.glossary).toBe('eye2gene');
	});

	it('does nothing the second time', async () => {
		await migrateGlossaries(vault, await loadWorkspaces(vault));
		const before = await Promise.all((await vault.list()).map(async (p) => [p, (await vault.read(p)).content]));
		expect(await migrateGlossaries(vault, await loadWorkspaces(vault))).toEqual({ moved: [], linked: [], left: [] });
		const after = await Promise.all((await vault.list()).map(async (p) => [p, (await vault.read(p)).content]));
		expect(after).toEqual(before);
	});

	it('never overwrites a glossary already in Glossaries/, and says so', async () => {
		await vault.write('Glossaries/eye2gene.md', '# Mine\n');
		const report = await migrateGlossaries(vault, await loadWorkspaces(vault));
		expect(report.left).toEqual([{ from: 'Work Projects/eye2gene/Glossary.md', to: 'Glossaries/eye2gene.md', why: 'Glossaries/eye2gene.md already exists' }]);
		expect(report.linked).toEqual([]);
		expect((await vault.read('Glossaries/eye2gene.md')).content).toBe('# Mine\n');
		expect((await vault.read('Work Projects/eye2gene/Glossary.md')).content).toBe(EYE);
		expect((await vault.read('_hub/workspaces/eye2gene.md')).content).toBe(EYE_DEF);
	});

	it('finishes a move interrupted after the copy', async () => {
		await vault.write('Glossaries/eye2gene.md', EYE);
		const report = await migrateGlossaries(vault, await loadWorkspaces(vault));
		expect(report.moved).toContainEqual({ from: 'Work Projects/eye2gene/Glossary.md', to: 'Glossaries/eye2gene.md' });
		expect((await vault.read('Work Projects/eye2gene/Glossary.md')).exists).toBe(false);
		expect((await vault.read('Glossaries/eye2gene.md')).content).toBe(EYE);
	});
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import { addTerm, deleteTerm, editTerm, glossaryPath, listGlossaries, loadGlossary, startGlossary, type CapturedTerm } from './glossary';
import type { Workspace } from './workspaces';

const ws = (slug: string, over: Partial<Workspace> = {}): Workspace => ({
	slug,
	name: slug,
	color: '#000',
	tag: `ws/${slug}`,
	aliases: [],
	folders: [slug[0].toUpperCase() + slug.slice(1)],
	path: `_hub/workspaces/${slug}.md`,
	...over
});

const captured = (term: string): CapturedTerm => ({
	term,
	source: '[[2026-09-28 Dev Weekly]]',
	meeting: { path: 'Work/Meetings/2026-09-28 Dev Weekly.md', title: 'Dev Weekly', date: '2026-09-28' }
});

describe('glossaryPath', () => {
	it.each([
		[['Work/Eye2Gene/', 'Other'], 'Work/Eye2Gene/Glossary.md'],
		[['/Garden'], 'Garden/Glossary.md'],
		[[], null]
	])('%j → %j', (folders, expected) => {
		expect(glossaryPath(ws('work', { folders }))).toBe(expected);
	});

	it('does not wait on meetings', () => {
		expect(glossaryPath(ws('work', { meetings: false }))).toBe('Work/Glossary.md');
	});
});

describe('the glossary on disk', () => {
	let dir: string;
	let vault: Vault;
	const work = ws('work');

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-'));
		vault = new Vault(dir);
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('reads a missing glossary as empty', async () => {
		expect(await loadGlossary(vault, work)).toEqual({ path: 'Work/Glossary.md', exists: false, content: '', entries: [], captured: [] });
		expect(await loadGlossary(vault, ws('none', { folders: [] }), [captured('DVC')])).toMatchObject({ path: null, captured: [] });
	});

	it('offers captured terms the glossary lacks, once each, and adds one', async () => {
		await vault.write('Work/Glossary.md', '# Glossary\n\n## DVC\n- status:: looked-up\n\nDefinition.\n');
		const glossary = await loadGlossary(vault, work, [
			captured('Cookie Cutter'),
			captured('dvc'),
			captured('cookie  cutter')
		]);
		expect(glossary.entries.map((e) => e.term)).toEqual(['DVC']);
		expect(glossary.captured).toEqual([captured('Cookie Cutter')]);

		const added = await addTerm(vault, work, glossary.captured[0]);
		expect(added).toEqual({ ok: true, path: 'Work/Glossary.md' });
		expect((await vault.read('Work/Glossary.md')).content).toBe(
			'# Glossary\n\n## DVC\n- status:: looked-up\n\nDefinition.\n\n## Cookie Cutter\n- status:: to-look-up\n- source:: [[2026-09-28 Dev Weekly]]\n'
		);
		expect(await addTerm(vault, work, { term: 'cookie cutter' })).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('creates the glossary when there is none, and writes a category', async () => {
		await addTerm(vault, work, { term: 'RPE', category: 'Anatomy' });
		expect((await vault.read('Work/Glossary.md')).content).toBe('# Glossary\n\n## RPE\n- status:: to-look-up\n- category:: Anatomy\n');
	});

	it('refuses an empty term and a workspace with no folder', async () => {
		expect(await addTerm(vault, work, { term: '  ' })).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await addTerm(vault, ws('none', { folders: [] }), { term: 'RPE' })).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read('Work/Glossary.md')).exists).toBe(false);
	});

	it('starts a glossary with a title line, and never over one that exists', async () => {
		expect(await startGlossary(vault, work)).toEqual({ ok: true, path: 'Work/Glossary.md' });
		expect((await vault.read('Work/Glossary.md')).content).toBe('# Glossary\n');
		await addTerm(vault, work, { term: 'RPE' });
		const before = (await vault.read('Work/Glossary.md')).content;
		expect(await startGlossary(vault, work)).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read('Work/Glossary.md')).content).toBe(before);
		expect(await startGlossary(vault, ws('none', { folders: [] }))).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('lists every workspace with its glossary size, started or not', async () => {
		await vault.write('Work/Glossary.md', '# Glossary\n\n## DVC\n- status:: looked-up\n\nTracks data.\n\n## MLflow\n- status:: to-look-up\n');
		const list = await listGlossaries(vault, [work, ws('garden'), ws('none', { folders: [] })]);
		expect(list.map((g) => [g.slug, g.path, g.exists, g.terms, g.pending])).toEqual([
			['work', 'Work/Glossary.md', true, 2, 1],
			['garden', 'Garden/Glossary.md', false, 0, 0],
			['none', null, false, 0, 0]
		]);
	});

	const TWO = '# Glossary\n\n## DVC\n- status:: looked-up\n- category:: ML\n\nTracks data.\n\n→ Traceable models.\n\n## MLflow\n- status:: to-look-up\n';

	it('edits a term in place: name, category, definition and why it matters', async () => {
		await vault.write('Work/Glossary.md', TWO);
		const edited = await editTerm(vault, work, 'dvc', { term: 'DVC (Data Version Control)', category: 'Tooling', definition: 'Versions data beside git.', relevance: 'Every model is traceable.' });
		expect(edited).toEqual({ ok: true, path: 'Work/Glossary.md' });
		expect((await vault.read('Work/Glossary.md')).content).toBe(
			'# Glossary\n\n## DVC (Data Version Control)\n- status:: looked-up\n- category:: Tooling\n\nVersions data beside git.\n\n→ Every model is traceable.\n\n## MLflow\n- status:: to-look-up\n'
		);
	});

	it('marks a pending term looked up once it is given a definition', async () => {
		await vault.write('Work/Glossary.md', TWO);
		await editTerm(vault, work, 'MLflow', { definition: 'Experiment tracking.' });
		expect((await loadGlossary(vault, work)).entries.find((e) => e.term === 'MLflow')).toMatchObject({ status: 'looked-up', pending: false, definition: 'Experiment tracking.' });
	});

	it('refuses a rename onto another term, an empty name and an unknown term, writing nothing', async () => {
		await vault.write('Work/Glossary.md', TWO);
		expect(await editTerm(vault, work, 'MLflow', { term: 'dvc' })).toEqual({ ok: false, reason: 'invalid', message: 'Another term already has that name.' });
		expect(await editTerm(vault, work, 'MLflow', { term: '  ' })).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await editTerm(vault, work, 'Missing', { category: 'x' })).toEqual({ ok: false, reason: 'invalid', message: 'That term is not in the glossary any more.' });
		expect((await vault.read('Work/Glossary.md')).content).toBe(TWO);
	});

	it('deletes a term and nothing else, and refuses one that is gone', async () => {
		await vault.write('Work/Glossary.md', TWO);
		expect(await deleteTerm(vault, work, 'dvc')).toEqual({ ok: true, path: 'Work/Glossary.md' });
		expect((await vault.read('Work/Glossary.md')).content).toBe('# Glossary\n\n## MLflow\n- status:: to-look-up\n');
		expect(await deleteTerm(vault, work, 'dvc')).toMatchObject({ ok: false, reason: 'invalid' });
	});
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from './vault/index';
import {
	addTerm,
	createGlossary,
	deleteGlossary,
	deleteTerm,
	editTerm,
	findGlossary,
	glossaries,
	isGlossaryPath,
	listGlossaries,
	loadGlossary,
	renameGlossary,
	setGlossaryStudy,
	studyLink,
	type GlossaryRef
} from './glossary';
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

describe('isGlossaryPath', () => {
	it.each([
		['Glossaries/CS.md', true],
		['Glossaries/Sub/CS.md', false],
		['Glossaries/.md', false],
		['Work/Glossary.md', false],
		['Glossaries/CS.txt', false]
	])('%s is a glossary: %s', (path, expected) => {
		expect(isGlossaryPath(path)).toBe(expected);
	});
});

describe('glossaries on disk', () => {
	let dir: string;
	let vault: Vault;
	const work = ws('work', { glossary: 'eye2gene', color: '#2f6fed' });
	const garden = ws('garden');

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-'));
		vault = new Vault(dir);
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('lists the files in Glossaries/ by name, with unique slugs and the workspaces pointing at each', async () => {
		await vault.write('Glossaries/eye2gene.md', '# Glossary\n');
		await vault.write('Glossaries/Computer Science.md', '# Glossary\n');
		await vault.write('Glossaries/C++.md', '# Glossary\n');
		await vault.write('Glossaries/C.md', '# Glossary\n');
		await vault.write('Glossaries/Old/Nested.md', '# Not a glossary\n');
		const list = await glossaries(vault, [work, garden, ws('other', { glossary: 'EYE2GENE' })]);
		expect(list.map((g) => [g.name, g.slug, g.path, g.linked.map((w) => w.slug), g.color])).toEqual([
			['C', 'c', 'Glossaries/C.md', [], '#6b7280'],
			['C++', 'c-2', 'Glossaries/C++.md', [], '#6b7280'],
			['Computer Science', 'computer-science', 'Glossaries/Computer Science.md', [], '#6b7280'],
			['eye2gene', 'eye2gene', 'Glossaries/eye2gene.md', ['work', 'other'], '#2f6fed']
		]);
		expect((await findGlossary(vault, [], 'computer-science'))?.name).toBe('Computer Science');
		expect(await findGlossary(vault, [], 'missing')).toBeNull();
	});

	it('has no glossaries when there is no folder', async () => {
		expect(await glossaries(vault, [work])).toEqual([]);
		expect(await listGlossaries(vault, [work])).toEqual([]);
	});

	it('counts terms and pending ones for the list', async () => {
		await vault.write('Glossaries/eye2gene.md', '# Glossary\n\n## DVC\n- status:: looked-up\n\nTracks data.\n\n## MLflow\n- status:: to-look-up\n');
		expect(await listGlossaries(vault, [work])).toEqual([
			{ name: 'eye2gene', slug: 'eye2gene', color: '#2f6fed', terms: 2, pending: 1 }
		]);
	});

	it('reads a missing glossary as empty', async () => {
		expect(await loadGlossary(vault, 'Glossaries/eye2gene.md')).toEqual({
			path: 'Glossaries/eye2gene.md',
			exists: false,
			content: '',
			entries: []
		});
	});

	it('adds a term with its source, and refuses one the glossary already has', async () => {
		const path = 'Glossaries/eye2gene.md';
		await vault.write(path, '# Glossary\n\n## DVC\n- status:: looked-up\n\nDefinition.\n');
		expect(await addTerm(vault, path, { term: 'Cookie Cutter', source: '[[2026-09-28 Dev Weekly]]' })).toEqual({ ok: true, path });
		expect((await vault.read(path)).content).toBe(
			'# Glossary\n\n## DVC\n- status:: looked-up\n\nDefinition.\n\n## Cookie Cutter\n- status:: to-look-up\n- source:: [[2026-09-28 Dev Weekly]]\n'
		);
		expect(await addTerm(vault, path, { term: 'cookie cutter' })).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('creates the file for a first term, and writes a category', async () => {
		await addTerm(vault, 'Glossaries/Anatomy.md', { term: 'RPE', category: 'Anatomy' });
		expect((await vault.read('Glossaries/Anatomy.md')).content).toBe('# Glossary\n\n## RPE\n- status:: to-look-up\n- category:: Anatomy\n');
		expect(await addTerm(vault, 'Glossaries/Anatomy.md', { term: '  ' })).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('creates a glossary with a title line, and refuses a name taken, unsafe or without letters', async () => {
		expect(await createGlossary(vault, ' Computer  Science ')).toEqual({ ok: true, path: 'Glossaries/Computer Science.md' });
		expect((await vault.read('Glossaries/Computer Science.md')).content).toBe('# Glossary\n');
		await addTerm(vault, 'Glossaries/Computer Science.md', { term: 'TCP' });
		const before = (await vault.read('Glossaries/Computer Science.md')).content;

		for (const name of ['computer science', 'Computer-Science', 'a/b', 'C: notes', '[[x]]', '', '+++']) {
			expect(await createGlossary(vault, name), name).toMatchObject({ ok: false, reason: 'invalid' });
		}
		expect((await vault.read('Glossaries/Computer Science.md')).content).toBe(before);
		expect((await glossaries(vault, [])).map((g) => g.name)).toEqual(['Computer Science']);
	});

	it('renames a glossary: same bytes under the new name, old file gone, workspaces repointed', async () => {
		const content = '# Glossary\n\n## DVC\n- status:: looked-up\n';
		await vault.write('Glossaries/eye2gene.md', content);
		const definition = '---\nname: work\nglossary: eye2gene # kept\nfolders: [Work]\n---\n\nBody.\n';
		await vault.write(work.path, definition);
		await vault.write(garden.path, '---\nname: garden\n---\n');

		const ref = (await findGlossary(vault, [work, garden], 'eye2gene'))!;
		expect(await renameGlossary(vault, ref, 'Eye2Gene Work')).toEqual({ ok: true, path: 'Glossaries/Eye2Gene Work.md' });
		expect((await vault.read('Glossaries/Eye2Gene Work.md')).content).toBe(content);
		expect((await vault.read('Glossaries/eye2gene.md')).exists).toBe(false);
		expect((await vault.read(work.path)).content).toBe(definition.replace('glossary: eye2gene # kept', 'glossary: Eye2Gene Work'));
		expect((await vault.read(garden.path)).content).toBe('---\nname: garden\n---\n');
	});

	it('refuses a rename onto a name that is taken, and renaming to the same name writes nothing', async () => {
		await vault.write('Glossaries/A.md', 'a\n');
		await vault.write('Glossaries/B.md', 'b\n');
		const a = (await findGlossary(vault, [], 'a'))!;
		expect(await renameGlossary(vault, a, 'b')).toEqual({ ok: false, reason: 'invalid', message: 'There is already a glossary with that name.' });
		expect(await renameGlossary(vault, a, 'A')).toEqual({ ok: true, path: 'Glossaries/A.md' });
		expect((await vault.read('Glossaries/A.md')).content).toBe('a\n');
		expect((await vault.read('Glossaries/B.md')).content).toBe('b\n');
		// A change of case alone is a rename of its own.
		expect(await renameGlossary(vault, a, 'a')).toEqual({ ok: true, path: 'Glossaries/a.md' });
		expect((await glossaries(vault, [])).map((g) => g.name)).toEqual(['a', 'B']);
	});

	it('deletes a glossary file and nothing else, and refuses one that is gone', async () => {
		await vault.write('Glossaries/A.md', 'a\n');
		await vault.write(work.path, '---\nglossary: A\n---\n');
		const a = (await findGlossary(vault, [], 'a'))!;
		expect(await deleteGlossary(vault, a)).toEqual({ ok: true, path: 'Glossaries/A.md' });
		expect((await vault.read('Glossaries/A.md')).exists).toBe(false);
		expect((await vault.read(work.path)).content).toBe('---\nglossary: A\n---\n');
		expect(await deleteGlossary(vault, a)).toMatchObject({ ok: false, reason: 'not-found' });
	});

	const TWO = '# Glossary\n\n## DVC\n- status:: looked-up\n- category:: ML\n\nTracks data.\n\n→ Traceable models.\n\n## MLflow\n- status:: to-look-up\n';
	const PATH = 'Glossaries/eye2gene.md';

	it('edits a term in place: name, category, definition and why it matters', async () => {
		await vault.write(PATH, TWO);
		const edited = await editTerm(vault, PATH, 'dvc', { term: 'DVC (Data Version Control)', category: 'Tooling', definition: 'Versions data beside git.', relevance: 'Every model is traceable.' });
		expect(edited).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(
			'# Glossary\n\n## DVC (Data Version Control)\n- status:: looked-up\n- category:: Tooling\n\nVersions data beside git.\n\n→ Every model is traceable.\n\n## MLflow\n- status:: to-look-up\n'
		);
	});

	it('marks a pending term looked up once it is given a definition', async () => {
		await vault.write(PATH, TWO);
		await editTerm(vault, PATH, 'MLflow', { definition: 'Experiment tracking.' });
		expect((await loadGlossary(vault, PATH)).entries.find((e) => e.term === 'MLflow')).toMatchObject({ status: 'looked-up', pending: false, definition: 'Experiment tracking.' });
	});

	it('refuses a rename onto another term, an empty name and an unknown term, writing nothing', async () => {
		await vault.write(PATH, TWO);
		expect(await editTerm(vault, PATH, 'MLflow', { term: 'dvc' })).toEqual({ ok: false, reason: 'invalid', message: 'Another term already has that name.' });
		expect(await editTerm(vault, PATH, 'MLflow', { term: '  ' })).toMatchObject({ ok: false, reason: 'invalid' });
		expect(await editTerm(vault, PATH, 'Missing', { category: 'x' })).toEqual({ ok: false, reason: 'invalid', message: 'That term is not in the glossary any more.' });
		expect((await vault.read(PATH)).content).toBe(TWO);
	});

	it('deletes a term and nothing else, and refuses one that is gone', async () => {
		await vault.write(PATH, TWO);
		expect(await deleteTerm(vault, PATH, 'dvc')).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe('# Glossary\n\n## MLflow\n- status:: to-look-up\n');
		expect(await deleteTerm(vault, PATH, 'dvc')).toMatchObject({ ok: false, reason: 'invalid' });
	});
});

const TWO = '# Glossary\n\n## DVC\n- status:: looked-up\n- category:: ML\n\nTracks data.\n\n→ Traceable models.\n\n## MLflow\n- status:: to-look-up\n';

describe('the study link', () => {
	let dir: string;
	let vault: Vault;
	const PATH = 'Glossaries/Computer Science.md';
	const REF: GlossaryRef = { name: 'Computer Science', slug: 'computer-science', path: PATH, linked: [], color: '#6b7280' };

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-study-'));
		vault = new Vault(dir);
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('links a glossary to a study subject as a span edit, clears it, and refuses a slug that is no subject', async () => {
		const subjects = [ws('cs', { template: 'study' }), ws('work')];
		await vault.write(PATH, TWO);
		expect(await setGlossaryStudy(vault, REF, subjects, 'cs')).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(`---\nstudy: cs\n---\n\n${TWO}`);
		expect(studyLink((await vault.read(PATH)).content)).toBe('cs');
		expect(await setGlossaryStudy(vault, REF, subjects, '')).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(`---\nstudy:\n---\n\n${TWO}`);
		expect(studyLink((await vault.read(PATH)).content)).toBeNull();

		const before = (await vault.read(PATH)).content;
		for (const bad of ['work', 'nope', 3, null]) {
			expect(await setGlossaryStudy(vault, REF, subjects, bad)).toMatchObject({ ok: false, reason: 'invalid' });
		}
		expect((await vault.read(PATH)).content).toBe(before);
	});
});

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
	glossaryOf,
	glossaryPath,
	isGlossaryPath,
	listGlossaries,
	loadGlossary,
	noteFolders,
	renameGlossary,
	addScannedTerms,
	scanNotes,
	scanSettings,
	setGlossarySources,
	withScannedTerms,
	type CapturedTerm,
	type GlossaryRef
} from './glossary';
import { MAX_NEW_ENTRIES, type ScannedEntry } from '$lib/shared/glossary';
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

describe('glossaryPath and isGlossaryPath', () => {
	it.each([
		['Computer Science', 'Glossaries/Computer Science.md'],
		['  eye2gene ', 'Glossaries/eye2gene.md'],
		['', null],
		['a/b', null],
		['..', null],
		['.hidden', null]
	])('%j → %j', (name, expected) => {
		expect(glossaryPath(name)).toBe(expected);
	});

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
	const work = ws('work', { glossary: 'eye2gene', meetings: true, color: '#2f6fed' });
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
			{ name: 'eye2gene', slug: 'eye2gene', color: '#2f6fed', terms: 2, pending: 1, linked: [{ slug: 'work', name: 'work' }] }
		]);
	});

	it('finds the glossary a workspace points at, ignoring case, or where one would go', async () => {
		expect(await glossaryOf(vault, garden)).toBeNull();
		expect(await glossaryOf(vault, ws('bad', { glossary: '../Escape' }))).toBeNull();
		expect(await glossaryOf(vault, work)).toEqual({ name: 'eye2gene', path: 'Glossaries/eye2gene.md' });
		await vault.write('Glossaries/Eye2Gene.md', '# Glossary\n');
		expect(await glossaryOf(vault, work)).toEqual({ name: 'Eye2Gene', path: 'Glossaries/Eye2Gene.md' });
	});

	it('reads a missing glossary as empty', async () => {
		expect(await loadGlossary(vault, 'Glossaries/eye2gene.md')).toEqual({
			path: 'Glossaries/eye2gene.md',
			exists: false,
			content: '',
			entries: [],
			captured: [],
			sources: [],
			scanned: null
		});
	});

	it('offers captured terms the glossary lacks, once each, and adds one', async () => {
		const path = 'Glossaries/eye2gene.md';
		await vault.write(path, '# Glossary\n\n## DVC\n- status:: looked-up\n\nDefinition.\n');
		const glossary = await loadGlossary(vault, path, [captured('Cookie Cutter'), captured('dvc'), captured('cookie  cutter')]);
		expect(glossary.entries.map((e) => e.term)).toEqual(['DVC']);
		expect(glossary.captured).toEqual([captured('Cookie Cutter')]);

		expect(await addTerm(vault, path, glossary.captured[0])).toEqual({ ok: true, path });
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
		const definition = '---\nname: work\nmeetings: true\nglossary: eye2gene # kept\nfolders: [Work]\n---\n\nBody.\n';
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

const entry = (over: Partial<ScannedEntry> = {}): ScannedEntry => ({
	term: 'Three-way handshake',
	category: 'Networking',
	definition: 'How TCP opens a connection.',
	relevance: 'Every connection starts with it.',
	source: 'CS/TCP.md',
	...over
});

/** What `withScannedTerms` appends for `entry()` with the fields given. */
const block = (term = 'Three-way handshake', lines = '- category:: Networking\n- source:: [[TCP]]', body = 'How TCP opens a connection.\n\n→ Every connection starts with it.') =>
	`\n## ${term}\n- status:: looked-up\n${lines}\n- drafted:: Claude\n\n${body}\n`;

describe('scanSettings', () => {
	it.each<[string, string, { sources: string[]; scanned: string | null }]>([
		['no frontmatter', TWO, { sources: [], scanned: null }],
		['a flow list and a bare date', '---\nsources: [CS, "/Deep/ML/"]\nscanned: 2026-09-29\n---\n', { sources: ['CS', 'Deep/ML'], scanned: '2026-09-29' }],
		['one folder as a string and a quoted date', '---\nsources: Computer Science\nscanned: "2026-09-29"\n---\n', { sources: ['Computer Science'], scanned: '2026-09-29' }],
		['repeats, blanks and non-strings dropped', '---\nsources:\n  - CS\n  - CS/\n  - ""\n  - 3\nscanned: yesterday\n---\n', { sources: ['CS'], scanned: null }],
		['a number and an impossible day', '---\nsources: 7\nscanned: "2026-02-30"\n---\n', { sources: [], scanned: null }],
		['a cleared key', '---\nsources:\nscanned:\n---\n', { sources: [], scanned: null }],
		['broken YAML', '---\nsources: [CS\n---\n', { sources: [], scanned: null }]
	])('%s', (_, content, expected) => {
		expect(scanSettings(content)).toEqual(expected);
	});
});

describe('withScannedTerms', () => {
	it.each<[string, string, ScannedEntry[], string | null, string | null]>([
		['appends after every byte, and gives a glossary with no frontmatter a block for scanned:', TWO, [entry()], '2026-09-29', `---\nscanned: "2026-09-29"\n---\n\n${TWO}${block()}`],
		['leaves scanned: alone when not asked', TWO, [entry()], null, `${TWO}${block()}`],
		['replaces scanned: in place, keeping sources: as written', `---\nsources: [CS]\nscanned: "2026-09-01"\n---\n${TWO}`, [entry()], '2026-09-29', `---\nsources: [CS]\nscanned: "2026-09-29"\n---\n${TWO}${block()}`],
		['only marks scanned when there is nothing to add', `---\nsources: [CS]\n---\n${TWO}`, [], '2026-09-29', `---\nsources: [CS]\nscanned: "2026-09-29"\n---\n${TWO}`],
		['writes no category or → line when there is none', TWO, [entry({ category: ' ', relevance: '' })], null, `${TWO}${block(undefined, '- source:: [[TCP]]', 'How TCP opens a connection.')}`],
		['closes up a file with no final newline', '# Glossary', [entry()], null, `# Glossary\n${block()}`],
		['names a note that would break a link bare', TWO, [entry({ source: 'CS/C# basics.md' })], null, `${TWO}${block(undefined, '- category:: Networking\n- source:: C# basics')}`],
		['defuses a definition line that would read as a heading', TWO, [entry({ definition: '# Not a heading\nStill prose.' })], null, `${TWO}${block(undefined, undefined, 'Not a heading\nStill prose.\n\n→ Every connection starts with it.')}`],
		['refuses a term the glossary has', TWO, [entry({ term: 'dvc' })], null, null],
		['refuses a term given twice', TWO, [entry(), entry({ term: 'three-way  HANDSHAKE' })], null, null],
		['refuses a term that is not its own heading', TWO, [entry({ term: 'C#' })], null, null]
	])('%s', (_, content, entries, scanned, expected) => {
		expect(withScannedTerms(content, entries, scanned)).toBe(expected);
	});
});

describe('scanning on disk', () => {
	let dir: string;
	let vault: Vault;
	const PATH = 'Glossaries/Computer Science.md';
	const REF: GlossaryRef = { name: 'Computer Science', slug: 'computer-science', path: PATH, linked: [], color: '#6b7280' };
	const SOURCED = `---\nsources:\n  - CS\n---\n\n${TWO}`;
	const TCP = '# TCP\n\nThe three-way handshake is SYN, SYN-ACK, ACK.\n';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'glossary-scan-'));
		vault = new Vault(dir);
		await vault.write('CS/TCP.md', TCP);
		await vault.write('CS/Deep/UDP.md', '# UDP\n');
		await vault.write('Work/Handbook.md', '# H\n');
		await vault.write('_hub/ai.md', '---\nenabled: true\n---\n');
		await vault.write('Private/Diary.md', 'secret', undefined, { scope: 'private' });
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('lists the folders and notes a scan may read, never the hub, the glossaries or the private folder', async () => {
		await vault.write(PATH, TWO);
		expect(await noteFolders(vault)).toEqual(['CS', 'CS/Deep', 'Work']);
		expect(await scanNotes(vault, ['/CS/'])).toEqual(['CS/Deep/UDP.md', 'CS/TCP.md']);
		expect(await scanNotes(vault, ['CS/Deep', 'Work', 'CS/Deep'])).toEqual(['CS/Deep/UDP.md', 'Work/Handbook.md']);
		expect(await scanNotes(vault, ['C'])).toEqual([]);
		expect(await scanNotes(vault, ['', '/'])).toEqual([]);
		expect(await scanNotes(vault, ['_hub', 'Glossaries', 'Private'])).toEqual([]);
	});

	it('sets the folders a glossary is scanned from as a span edit, and refuses one that is not a folder of notes', async () => {
		await vault.write(PATH, TWO);
		expect(await setGlossarySources(vault, REF, ['CS', '/Work/', 'CS'])).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(`---\nsources:\n  - CS\n  - Work\n---\n\n${TWO}`);
		expect(await setGlossarySources(vault, REF, ['CS'])).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(`---\nsources:\n  - CS\n---\n\n${TWO}`);
		expect(await setGlossarySources(vault, REF, [])).toEqual({ ok: true, path: PATH });
		expect((await vault.read(PATH)).content).toBe(`---\nsources:\n---\n\n${TWO}`);

		const before = (await vault.read(PATH)).content;
		for (const bad of [['Nowhere'], ['Glossaries'], ['_hub'], ['Private'], 'CS', [3]]) {
			expect(await setGlossarySources(vault, REF, bad)).toMatchObject({ ok: false, reason: 'invalid' });
		}
		expect((await vault.read(PATH)).content).toBe(before);
	});

	it('adds the entries sent, marks the glossary scanned, and reads back', async () => {
		await vault.write(PATH, SOURCED);
		const result = await addScannedTerms(vault, REF, { entries: [entry(), entry({ term: 'Socket', category: '', source: 'CS/Deep/UDP.md' })], complete: true }, '2026-09-29');
		expect(result).toEqual({ ok: true, path: PATH, added: 2 });
		expect((await vault.read(PATH)).content).toBe(
			`---\nsources:\n  - CS\nscanned: "2026-09-29"\n---\n\n${TWO}${block()}${block('Socket', '- source:: [[UDP]]')}`
		);
		// A stopped scan adds without marking.
		expect(await addScannedTerms(vault, REF, { entries: [entry({ term: 'SYN' })], complete: false }, '2026-10-01')).toMatchObject({ ok: true, added: 1 });
		expect(scanSettings((await vault.read(PATH)).content).scanned).toBe('2026-09-29');
		// A full scan that found nothing only marks.
		expect(await addScannedTerms(vault, REF, { entries: [], complete: true }, '2026-10-02')).toEqual({ ok: true, path: PATH, added: 0 });
		expect(scanSettings((await vault.read(PATH)).content).scanned).toBe('2026-10-02');
	});

	it.each<[string, unknown, string]>([
		['nothing to add', [], 'There are no terms to add.'],
		['not a list', 'x', 'There are no terms to add.'],
		['not an entry', [null], 'Term 1 is not a glossary entry.'],
		['a field that is not text', [{ ...entry(), definition: 3 }], '“Three-way handshake” is not a glossary entry.'],
		['no term', [entry({ term: '  ' })], 'Term 1 needs a name.'],
		['no definition', [entry({ definition: ' ' })], '“Three-way handshake” needs a definition.'],
		['a term too long', [entry({ term: 'x'.repeat(121) })], `“${'x'.repeat(121)}” is too long.`],
		['a definition too long', [entry({ definition: 'x'.repeat(1501) })], '“Three-way handshake” is too long.'],
		['a term that cannot be a heading', [entry({ term: 'C#' })], '“C#” cannot be written as a heading.'],
		['a term the glossary has', [entry({ term: 'mlflow' })], '“mlflow” is already in the glossary.'],
		['a term sent twice', [entry(), entry({ term: 'three-way handshake' })], '“three-way handshake” is in the list twice.'],
		['a note outside the sources', [entry({ source: 'Work/Handbook.md' })], '“Three-way handshake” names a note that is not under this glossary\'s folders.'],
		['a note that is not there', [entry({ source: 'CS/Gone.md' })], '“Three-way handshake” names a note that is not under this glossary\'s folders.'],
		['a note that is not markdown', [entry({ source: 'CS/TCP.txt' })], '“Three-way handshake” names a note that is not under this glossary\'s folders.'],
		['two problems at once', [entry({ term: 'DVC' }), entry({ term: 'X', definition: '' })], '“DVC” is already in the glossary. “X” needs a definition.']
	])('refuses %s and writes nothing', async (_, entries, message) => {
		await vault.write(PATH, SOURCED);
		expect(await addScannedTerms(vault, REF, { entries, complete: false }, '2026-09-29')).toEqual({ ok: false, reason: 'invalid', message });
		expect((await vault.read(PATH)).content).toBe(SOURCED);
	});

	it('refuses a glossary that is gone, one with no sources, and more entries than one add may carry', async () => {
		expect(await addScannedTerms(vault, REF, { entries: [entry()], complete: true }, '2026-09-29')).toMatchObject({ ok: false, reason: 'not-found' });
		await vault.write(PATH, TWO);
		expect(await addScannedTerms(vault, REF, { entries: [entry()], complete: true }, '2026-09-29')).toMatchObject({ ok: false, reason: 'invalid' });
		await vault.write(PATH, SOURCED);
		const many = Array.from({ length: MAX_NEW_ENTRIES + 1 }, (_, i) => entry({ term: `T${i}` }));
		expect(await addScannedTerms(vault, REF, { entries: many, complete: true }, '2026-09-29')).toMatchObject({ ok: false, reason: 'invalid' });
		expect((await vault.read(PATH)).content).toBe(SOURCED);
	});

	it('writes nothing when the glossary changes between the read and the write', async () => {
		await vault.write(PATH, SOURCED);
		const edited = `${SOURCED}\n## Added in Obsidian\n`;
		class Racing extends Vault {
			raced = false;
			override async write(...args: Parameters<Vault['write']>) {
				if (args[0] === PATH && args[2] !== undefined && !this.raced) {
					this.raced = true;
					await super.write(PATH, edited);
				}
				return super.write(...args);
			}
		}
		const racing = new Racing(dir);
		expect(await addScannedTerms(racing, REF, { entries: [entry()], complete: true }, '2026-09-29')).toMatchObject({ ok: false, reason: 'conflict' });
		expect((await vault.read(PATH)).content).toBe(edited);
	});
});

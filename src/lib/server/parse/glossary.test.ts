import { describe, expect, it } from 'vitest';
import { appendEntry, findEntry, insertDefinition, normaliseTerm, parseGlossary, setField } from './glossary';

const GLOSSARY = `# Glossary

Terms from the dev meetings.

## DVC
- guess:: Data version control, keep track of model output
- status:: looked-up
- category:: ML
- source:: [[2026-09-28 Dev Weekly]]
- drafted:: Claude

Open-source tool that versions datasets and models alongside git.

It stores large files remotely.

→ For Eye2Gene, DVC makes training data traceable.

## Cookie Cutter
- guess:: something for AI models
- status:: to-look-up
- source:: [[2026-09-28 Dev Weekly]]

## RPE
Retinal pigment epithelium.

### Aside
A sub-heading belongs to its entry.

\`\`\`
## Not an entry
\`\`\`
`;

describe('parseGlossary', () => {
	const entries = parseGlossary(GLOSSARY);

	it('finds each ## entry and nothing inside a fence', () => {
		expect(entries.map((e) => e.term)).toEqual(['DVC', 'Cookie Cutter', 'RPE']);
	});

	it('reads fields, definition and relevance', () => {
		expect(entries[0]).toMatchObject({
			term: 'DVC',
			line: 4,
			guess: 'Data version control, keep track of model output',
			status: 'looked-up',
			category: 'ML',
			source: '[[2026-09-28 Dev Weekly]]',
			definition: 'Open-source tool that versions datasets and models alongside git.\n\nIt stores large files remotely.',
			relevance: 'For Eye2Gene, DVC makes training data traceable.',
			pending: false
		});
		expect(entries[0].fields.drafted.value).toBe('Claude');
		expect(entries[0].end).toBe(16);
	});

	it('marks to-look-up entries as pending', () => {
		expect(entries[1]).toMatchObject({ status: 'to-look-up', definition: '', relevance: null, category: null, pending: true });
	});

	it('keeps sub-headings and fenced text in the definition', () => {
		expect(entries[2].definition).toContain('### Aside');
		expect(entries[2].definition).toContain('## Not an entry');
		expect(entries[2].pending).toBe(false);
	});

	it.each([
		['## Term\n', { term: 'Term', pending: true, definition: '' }],
		['## Term\n- status:: Looked-Up\n', { status: 'looked-up', pending: false }],
		['## Term ##\nText\n', { term: 'Term', definition: 'Text', pending: false }],
		['## Term\n- guess::\n', { guess: null }],
		['## Term\r\n- guess:: g\r\n\r\nDef\r\n', { guess: 'g', definition: 'Def' }],
		['##NoSpace\n', null]
	])('reads %j', (content, expected) => {
		const [entry] = parseGlossary(content);
		if (expected === null) expect(entry).toBeUndefined();
		else expect(entry).toMatchObject(expected);
	});

	it('stops an entry at a level-one heading', () => {
		const [entry] = parseGlossary('## A\ntext\n# Other\nmore\n');
		expect(entry.definition).toBe('text');
	});
});

describe('findEntry', () => {
	it('matches case-insensitively and ignores spacing', () => {
		expect(findEntry(GLOSSARY, '  cookie   cutter ')?.term).toBe('Cookie Cutter');
		expect(findEntry(GLOSSARY, 'Nope')).toBeNull();
		expect(normaliseTerm(' A  B ')).toBe('a b');
	});
});

describe('setField', () => {
	it('replaces only the value of an existing field', () => {
		const after = setField(GLOSSARY, 'Cookie Cutter', 'status', 'looked-up')!;
		const a = GLOSSARY.split('\n');
		const b = after.split('\n');
		expect(b).toHaveLength(a.length);
		expect(b.filter((l, i) => l !== a[i])).toEqual(['- status:: looked-up']);
	});

	it('keeps the key and bullet as written', () => {
		expect(setField('## T\n* Status::  old  \n', 'T', 'status', 'new')).toBe('## T\n* Status::  new  \n');
	});

	it('adds a missing field after the last field', () => {
		expect(setField('## T\n- guess:: g\n- status:: s\n\nDef\n', 'T', 'drafted', 'Claude')).toBe(
			'## T\n- guess:: g\n- status:: s\n- drafted:: Claude\n\nDef\n'
		);
	});

	it('adds a field under a heading with none', () => {
		expect(setField('## RPE\nRetinal.\n', 'rpe', 'status', 'looked-up')).toBe('## RPE\n- status:: looked-up\nRetinal.\n');
	});

	it('returns null for a missing entry', () => {
		expect(setField(GLOSSARY, 'Missing', 'status', 'x')).toBeNull();
	});
});

describe('insertDefinition', () => {
	it('inserts under an entry followed by another', () => {
		const after = insertDefinition(GLOSSARY, 'Cookie Cutter', 'A Python scaffolding tool.', 'For Eye2Gene, it keeps projects consistent.')!;
		expect(after).toContain(
			'- source:: [[2026-09-28 Dev Weekly]]\n\nA Python scaffolding tool.\n\n→ For Eye2Gene, it keeps projects consistent.\n\n## RPE'
		);
		// Every original line survives, in order.
		const b = after.split('\n');
		let j = 0;
		for (const line of GLOSSARY.split('\n')) {
			while (b[j] !== line) j++;
			j++;
		}
		const [, cookie] = parseGlossary(after);
		expect(cookie).toMatchObject({ definition: 'A Python scaffolding tool.', relevance: 'For Eye2Gene, it keeps projects consistent.' });
	});

	it.each([
		['no trailing newline', '## A\n- status:: to-look-up', '## A\n- status:: to-look-up\n\nDef.\n\n→ Why.\n'],
		['one trailing newline', '## A\n- status:: to-look-up\n', '## A\n- status:: to-look-up\n\nDef.\n\n→ Why.\n'],
		['two trailing newlines', '## A\n- status:: to-look-up\n\n', '## A\n- status:: to-look-up\n\nDef.\n\n→ Why.\n\n'],
		['next heading straight after', '## A\n- status:: to-look-up\n## B\n', '## A\n- status:: to-look-up\n\nDef.\n\n→ Why.\n\n## B\n']
	])('%s', (_name, before, after) => {
		expect(insertDefinition(before, 'A', 'Def.', 'Why.')).toBe(after);
	});

	it('leaves out an empty relevance', () => {
		expect(insertDefinition('## A\n', 'A', 'Def.', '  ')).toBe('## A\n\nDef.\n');
	});

	it('defuses prose that would read as grammar', () => {
		const after = insertDefinition('## A\n', 'A', '## Heading\n- key:: value\n→ arrow', 'Why')!;
		const [entry, ...rest] = parseGlossary(after);
		expect(rest).toEqual([]);
		expect(Object.keys(entry.fields)).toEqual([]);
		expect(entry.relevance).toBe('Why');
	});

	it('returns null for a missing entry', () => {
		expect(insertDefinition(GLOSSARY, 'Nope', 'd', 'r')).toBeNull();
	});
});

describe('appendEntry', () => {
	const entry = { term: 'Cookie Cutter', guess: 'something for AI models', source: '[[2026-09-28 Dev Weekly]]' };
	const block = '## Cookie Cutter\n- guess:: something for AI models\n- status:: to-look-up\n- source:: [[2026-09-28 Dev Weekly]]\n';

	it.each([
		['an empty note', '', `# Glossary\n\n${block}`],
		['a note ending in one newline', '## A\n', `## A\n\n${block}`],
		['a note ending in a blank line', '## A\n\n', `## A\n\n${block}`],
		['a note with no final newline', '## A', `## A\n\n${block}`]
	])('appends to %s', (_name, before, after) => {
		expect(appendEntry(before, entry)).toBe(after);
	});

	it('leaves out an empty guess and writes a category when given', () => {
		expect(appendEntry('', { term: 'X', guess: ' ', category: 'ML' })).toBe('# Glossary\n\n## X\n- status:: to-look-up\n- category:: ML\n');
	});

	it('parses back as a pending entry', () => {
		const [added] = parseGlossary(appendEntry('', entry));
		expect(added).toMatchObject({ term: 'Cookie Cutter', guess: 'something for AI models', pending: true });
	});
});
